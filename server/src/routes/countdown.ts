import { Router } from "express";
import { z } from "zod";
import { HoldType, MissionHistoryEventType, MissionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireLaunchDirector, requireRole } from "../middleware/auth";
import { Role } from "@prisma/client";
import { recordAudit } from "../services/audit";
import { broadcastMissionUpdate } from "../websocket";
import { computeTCountSeconds, computeProjectedLiftoff } from "../services/countdown";
import { COUNTDOWN_MILESTONE_SEQUENCE } from "../services/countdownSequence";
import { computeCoaStatus } from "../services/faa";
import {
  COMR_DOCUMENT_CATEGORY,
  COFR_DOCUMENT_CATEGORY,
  COFR_COMPLIANCE_WINDOW_HOURS,
  LOT_CERTIFICATION_TEXTS,
  validateDailyOperationalWindow,
} from "../services/lotCertification";

const router = Router({ mergeParams: true });
const requireConsole = requireRole(Role.ADMIN, Role.LAUNCH_DIRECTOR, Role.OPERATOR);

function missionId(req: any): string {
  return (req.params as { missionId: string }).missionId;
}

async function loadMissionWithHolds(mId: string) {
  return prisma.mission.findUnique({
    where: { id: mId },
    include: { launchPeriodEntries: true, holds: { orderBy: { holdMarkSeconds: "desc" } } },
  });
}

// ---------------------------------------------------------------------------
// State snapshot - the frontend ticks Test Clock/Launch Clock locally from this.
// ---------------------------------------------------------------------------

router.get("/state", async (req, res) => {
  const mission = await loadMissionWithHolds(missionId(req));
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  const activeHold = mission.holds.find((h) => h.status === "ACTIVE") ?? null;
  const currentTMinusSeconds = computeTCountSeconds(mission, activeHold);
  const projectedLiftoff = computeProjectedLiftoff(mission, mission.holds);

  res.json({
    lot: mission.lot,
    lotSubmittedAt: mission.lotSubmittedAt,
    tCountStatus: mission.tCountStatus,
    holdOffsetSeconds: mission.holdOffsetSeconds,
    liftoffActualTime: mission.liftoffActualTime,
    currentTMinusSeconds,
    projectedLiftoff,
    activeHold,
    holds: mission.holds,
  });
});

// ---------------------------------------------------------------------------
// LOT Submission Query (Section 6.2.2)
// ---------------------------------------------------------------------------

const lotSchema = z.object({
  lot: z.string(),
  comrDocumentId: z.string().min(1, "A Certification of Mission Readiness (CoMR) document must be selected"),
  // All eight certification statements are individually required; the
  // client sends which of the eight fixed statements (by index) the user
  // affirmed, and the server rejects unless all eight are true. The exact
  // verbatim text is never taken from the client - it is always the
  // server's own LOT_CERTIFICATION_TEXTS - so what gets stored as "the text
  // affirmed" can never drift from the governing statements.
  certifications: z.array(z.boolean()).length(8, "All eight certification statements must be present"),
  signatureName: z.string().min(1, "Typed full legal name is required"),
  signatureRole: z.string().min(1, "Role is required"),
});

function validateLotWindow(lot: Date, targeted: { windowOpen: Date; windowClose: Date } | undefined) {
  if (!targeted) return "Mission has no confirmed Target Launch Opportunity";
  if (lot < targeted.windowOpen || lot > targeted.windowClose) {
    return `Targeted LOT must fall within the confirmed launch window (${targeted.windowOpen.toISOString()} – ${targeted.windowClose.toISOString()})`;
  }
  return null;
}

// v5.0 Section 7 - full LOT Submission rebuild, governed by the reference
// MOP (IRM2-MOP-001A Section 5): only launch date/time is load-bearing from
// the old form; the five free-text constraint fields are gone, replaced by
// a mandatory CoMR selection, eight verbatim certification statements, and
// an e-signature of record, all stored permanently in LotCertification.
router.post("/lot", requireLaunchDirector, async (req, res) => {
  const parsed = lotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  if (parsed.data.certifications.some((affirmed) => !affirmed)) {
    return res.status(400).json({ error: "All eight certification statements must be affirmed before the LOT can be submitted" });
  }

  const mission = await prisma.mission.findUnique({
    where: { id: missionId(req) },
    include: { launchPeriodEntries: true, holds: true, site: { include: { coas: true } } },
  });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (mission.status !== MissionStatus.TARGETED) {
    return res.status(400).json({ error: "LOT can only be submitted once a Target Launch Opportunity is confirmed" });
  }
  if (mission.lot) {
    return res.status(400).json({ error: "LOT already established - use PATCH to revise it" });
  }

  const lot = new Date(parsed.data.lot);
  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  const windowError = validateLotWindow(lot, targeted);
  if (windowError) return res.status(400).json({ error: windowError });

  // v5.0 Section 7.3 - corrected validation: the LOT must ALSO fall within
  // the site's active COA's Daily Operational Window, read directly off the
  // COA record (not re-entered on the form).
  const activeCoa = mission.site.coas.find((c) => computeCoaStatus(c) === "ACTIVE");
  if (!activeCoa) {
    return res.status(400).json({ error: "Site has no active Certificate of Waiver or Authorization (COA) on file" });
  }
  const dailyWindowError = validateDailyOperationalWindow(lot, activeCoa.dailyWindowOpen, activeCoa.dailyWindowClose);
  if (dailyWindowError) return res.status(400).json({ error: dailyWindowError });

  // v5.0 Section 7.4 - CoMR must exist and be tagged with the CoMR category.
  const comrDoc = await prisma.document.findUnique({ where: { id: parsed.data.comrDocumentId } });
  if (!comrDoc || comrDoc.category !== COMR_DOCUMENT_CATEGORY) {
    return res.status(400).json({ error: "Selected document is not a valid Certification of Mission Readiness (CoMR)" });
  }

  // Checkbox 8 - basis is determined automatically, not self-reported: if a
  // CoFR document is already on file for the assigned vehicle the
  // attestation is satisfied outright; otherwise the 24-hour compliance
  // deadline gate (Section 7.4) starts running from this LOT.
  const cofrDoc = await prisma.document.findFirst({ where: { category: COFR_DOCUMENT_CATEGORY, vehicleId: mission.vehicleId } });
  const cofrBasis = cofrDoc ? "APPROVED_ON_FILE" : "WILL_FILE_WITHIN_24H";
  const cofrComplianceDeadline = cofrDoc ? null : new Date(lot.getTime() - COFR_COMPLIANCE_WINDOW_HOURS * 60 * 60 * 1000);

  const certifications = LOT_CERTIFICATION_TEXTS.map((text, i) => ({ no: i + 1, text }));
  const logText = `LOT submitted: ${lot.toISOString()} — CoMR: "${comrDoc.title}". Signed by ${parsed.data.signatureName} (${parsed.data.signatureRole}).`;

  await prisma.$transaction(async (tx) => {
    await tx.mission.update({
      where: { id: mission.id },
      data: { lot, lotSubmittedAt: new Date(), tCountStatus: "COUNTING", holdOffsetSeconds: 0 },
    });
    await tx.lotCertification.create({
      data: {
        missionId: mission.id,
        comrDocumentId: comrDoc.id,
        certifications,
        signatureName: parsed.data.signatureName,
        signatureRole: parsed.data.signatureRole,
        signedById: req.user!.id,
        cofrBasis,
        cofrComplianceDeadline,
      },
    });
    await tx.missionHistoryEvent.create({
      data: { missionId: mission.id, eventType: MissionHistoryEventType.LOT_SUBMITTED, actorId: req.user!.id, notes: `LOT established: ${lot.toISOString()}` },
    });
    // v5.0 Section 7.4 - auto-logged to the mission's Log tab; no separate
    // manual log entry is required.
    await tx.missionLogEntry.create({ data: { missionId: mission.id, authorId: req.user!.id, text: logText } });
  });

  await recordAudit({ userId: req.user!.id, action: "LOT_SUBMITTED", targetType: "Mission", targetId: mission.id, metadata: { lot, comrDocumentId: comrDoc.id, cofrBasis } });
  broadcastMissionUpdate(mission.id);
  res.status(204).send();
});

// v5.0 Section 7.4 - permanent CoMR/certification/signature record for the
// mission's current LOT, viewable via Mission History.
router.get("/lot/certification", async (req, res) => {
  const certification = await prisma.lotCertification.findFirst({
    where: { missionId: missionId(req) },
    orderBy: { signedAt: "desc" },
    include: { comrDocument: { select: { id: true, title: true, category: true } }, signedBy: { select: { id: true, name: true } } },
  });
  res.json(certification);
});

// v5.0 Section 7.4 - Launch Director confirms a CoFR document is now on
// file for the assigned vehicle, resolving the compliance gate and
// resuming T-Count. This is the ONLY way (besides Postpone Indefinitely) to
// clear a CoFR compliance gate hold - the general-purpose Release Hold
// action explicitly refuses it (see POST /holds/:holdId/release above).
router.post("/cofr-gate/confirm", requireLaunchDirector, async (req, res) => {
  const mission = await loadMissionWithHolds(missionId(req));
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  const gateHold = mission.holds.find((h) => h.isCofrComplianceHold && h.status === "ACTIVE");
  if (!gateHold || !gateHold.actualStartedAt) {
    return res.status(400).json({ error: "No active CoFR compliance gate for this mission" });
  }

  const cofrDoc = await prisma.document.findFirst({ where: { category: COFR_DOCUMENT_CATEGORY, vehicleId: mission.vehicleId } });
  if (!cofrDoc) {
    return res.status(400).json({
      error:
        "No Certification of Flight Readiness document is on file for the assigned vehicle. Upload/tag one in the Documentation Library before confirming, or execute Postpone Indefinitely.",
    });
  }

  const actualDurationSeconds = Math.round((Date.now() - gateHold.actualStartedAt.getTime()) / 1000);
  const latestCert = await prisma.lotCertification.findFirst({ where: { missionId: mission.id, cofrGateHoldId: gateHold.id } });

  await prisma.$transaction(async (tx) => {
    await tx.missionHold.update({
      where: { id: gateHold.id },
      data: { status: "RELEASED", actualEndedAt: new Date(), actualDurationSeconds },
    });
    await tx.mission.update({
      where: { id: mission.id },
      data: { tCountStatus: "COUNTING", holdOffsetSeconds: { increment: actualDurationSeconds } },
    });
    if (latestCert) {
      await tx.lotCertification.update({
        where: { id: latestCert.id },
        data: { cofrGateResolvedAt: new Date(), cofrGateResolvedById: req.user!.id },
      });
    }
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.COFR_COMPLIANCE_RESOLVED,
        actorId: req.user!.id,
        notes: `CoFR confirmed on file ("${cofrDoc.title}"); countdown resumed after ${actualDurationSeconds}s blocked`,
        metadata: { holdId: gateHold.id, actualDurationSeconds, cofrDocumentId: cofrDoc.id },
      },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "COFR_COMPLIANCE_GATE_RESOLVED", targetType: "Mission", targetId: mission.id, metadata: { holdId: gateHold.id, actualDurationSeconds } });
  broadcastMissionUpdate(mission.id);
  res.status(204).send();
});

// Section 6.2.5 - SELECT NEW TIME WITHIN WINDOW
router.patch("/lot", requireLaunchDirector, async (req, res) => {
  const parsed = z.object({ lot: z.string(), reason: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A new LOT and reason are required" });

  const mission = await loadMissionWithHolds(missionId(req));
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (!mission.lot) return res.status(400).json({ error: "No LOT established to revise" });

  const lot = new Date(parsed.data.lot);
  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  const windowError = validateLotWindow(lot, targeted);
  if (windowError) return res.status(400).json({ error: windowError });

  const previousLot = mission.lot;

  await prisma.$transaction(async (tx) => {
    await tx.mission.update({ where: { id: mission.id }, data: { lot } });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.LOT_REVISED,
        actorId: req.user!.id,
        notes: parsed.data.reason,
        metadata: { previousLot, newLot: lot },
      },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "LOT_REVISED", targetType: "Mission", targetId: mission.id, metadata: { previousLot, newLot: lot } });
  broadcastMissionUpdate(mission.id);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Hold management (Section 6.2.3)
// ---------------------------------------------------------------------------

const programmedHoldSchema = z.object({ holdMarkSeconds: z.number(), estimatedDurationSeconds: z.number(), reason: z.string().optional() });

router.post("/holds", requireLaunchDirector, async (req, res) => {
  const parsed = programmedHoldSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mission = await loadMissionWithHolds(missionId(req));
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (!mission.lot) return res.status(400).json({ error: "Test Clock is not established" });

  const activeHold = mission.holds.find((h) => h.status === "ACTIVE") ?? null;
  const currentTMinus = computeTCountSeconds(mission, activeHold);
  if (currentTMinus != null && parsed.data.holdMarkSeconds >= currentTMinus) {
    return res.status(400).json({ error: "Hold mark has already been reached by the Test Clock" });
  }

  const hold = await prisma.missionHold.create({
    data: {
      missionId: mission.id,
      type: HoldType.PROGRAMMED,
      holdMarkSeconds: parsed.data.holdMarkSeconds,
      estimatedDurationSeconds: parsed.data.estimatedDurationSeconds,
      reason: parsed.data.reason,
      enteredById: req.user!.id,
    },
  });
  broadcastMissionUpdate(mission.id);
  res.status(201).json(hold);
});

router.delete("/holds/:holdId", requireLaunchDirector, async (req, res) => {
  const hold = await prisma.missionHold.findUnique({ where: { id: req.params.holdId } });
  if (!hold || hold.missionId !== missionId(req)) return res.status(404).json({ error: "Hold not found" });
  if (hold.status !== "SCHEDULED") return res.status(400).json({ error: "Only a not-yet-reached scheduled hold can be removed" });
  await prisma.missionHold.delete({ where: { id: hold.id } });
  broadcastMissionUpdate(missionId(req));
  res.status(204).send();
});

// v4.1 Item 2 - Auto-Proceed/Manual-Proceed toggle, live-adjustable in
// either direction for the entire time a PROGRAMMED hold is ACTIVE (never
// fixed at scheduling time, never locked once active). Read by the same
// live scheduler (services/holdScheduler.ts) that triggers the hold in the
// first place, so flipping it to Auto mid-hold takes effect on the very
// next tick, not on some later page load.
router.patch("/holds/:holdId/auto-proceed", requireLaunchDirector, async (req, res) => {
  const parsed = z.object({ autoProceed: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "autoProceed (boolean) is required" });

  const hold = await prisma.missionHold.findUnique({ where: { id: req.params.holdId } });
  if (!hold || hold.missionId !== missionId(req)) return res.status(404).json({ error: "Hold not found" });
  if (hold.type !== "PROGRAMMED") return res.status(400).json({ error: "Auto-Proceed only applies to programmed holds" });
  if (hold.status !== "ACTIVE") return res.status(400).json({ error: "Auto-Proceed can only be changed while the hold is active" });

  const updated = await prisma.missionHold.update({ where: { id: hold.id }, data: { autoProceed: parsed.data.autoProceed } });
  broadcastMissionUpdate(missionId(req));
  res.json(updated);
});

// v4.1 Item 1 - hold triggering used to be a client-driven POST fired from
// CountdownTab.tsx's ticking clock, which meant a hold's mark was only ever
// detected while that specific component happened to be mounted somewhere -
// the root cause of the late-trigger defect. That responsibility now
// belongs entirely to the server-side hold scheduler
// (services/holdScheduler.ts), which runs continuously and is the sole
// source of truth regardless of any connected client; there is no
// client-callable trigger endpoint anymore.

type CallHoldResult =
  | { ok: true; hold: Awaited<ReturnType<typeof prisma.missionHold.create>> }
  | { ok: false; status: 400 | 404; message: string };

async function callHold(mId: string, userId: string, reason: string): Promise<CallHoldResult> {
  const mission = await loadMissionWithHolds(mId);
  if (!mission) return { ok: false, status: 404, message: "Mission not found" };
  if (!mission.lot) return { ok: false, status: 400, message: "Test Clock is not established" };
  if (mission.holds.some((h) => h.status === "ACTIVE")) return { ok: false, status: 400, message: "A hold is already active" };
  if (mission.tCountStatus !== "COUNTING") return { ok: false, status: 400, message: "Test Clock is not currently counting" };

  const currentTMinus = computeTCountSeconds(mission, null) ?? 0;

  const hold = await prisma.$transaction(async (tx) => {
    const h = await tx.missionHold.create({
      data: {
        missionId: mId,
        type: HoldType.UNSCHEDULED,
        holdMarkSeconds: Math.round(currentTMinus),
        status: "ACTIVE",
        actualStartedAt: new Date(),
        reason,
        enteredById: userId,
      },
    });
    await tx.mission.update({ where: { id: mId }, data: { tCountStatus: "HOLDING" } });
    await tx.missionHistoryEvent.create({
      data: { missionId: mId, eventType: MissionHistoryEventType.HOLD_CALLED, actorId: userId, notes: reason, metadata: { holdId: h.id, unscheduled: true } },
    });
    return h;
  });

  await recordAudit({ userId, action: "HOLD_CALLED", targetType: "Mission", targetId: mId, metadata: { holdId: hold.id } });
  broadcastMissionUpdate(mId);
  return { ok: true, hold };
}

// CALL HOLD - unscheduled, immediate
router.post("/holds/call", requireLaunchDirector, async (req, res) => {
  const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A reason is required to call a hold" });

  const result = await callHold(missionId(req), req.user!.id, parsed.data.reason);
  if (!result.ok) return res.status(result.status).json({ error: result.message });
  res.status(201).json(result.hold);
});

// PROCEED THROUGH HOLD
router.post("/holds/:holdId/release", requireLaunchDirector, async (req, res) => {
  const mId = missionId(req);
  const hold = await prisma.missionHold.findUnique({ where: { id: req.params.holdId } });
  if (!hold || hold.missionId !== mId) return res.status(404).json({ error: "Hold not found" });
  if (hold.status !== "ACTIVE" || !hold.actualStartedAt) return res.status(400).json({ error: "Hold is not currently active" });
  // v5.0 Section 7.4 - a CoFR compliance gate hold is a hard procedural
  // gate, not an ordinary hold: it can only be cleared via POST
  // .../cofr-gate/confirm (which validates a CoFR document actually exists)
  // or Postpone Indefinitely, never the general-purpose Release Hold action.
  if (hold.isCofrComplianceHold) {
    return res.status(400).json({
      error:
        "This hold was raised by the CoFR compliance gate and cannot be released here. Confirm a Certification of Flight Readiness is now on file for the assigned vehicle, or execute Postpone Indefinitely.",
    });
  }

  const actualDurationSeconds = Math.round((Date.now() - hold.actualStartedAt.getTime()) / 1000);

  await prisma.$transaction(async (tx) => {
    await tx.missionHold.update({
      where: { id: hold.id },
      data: { status: "RELEASED", actualEndedAt: new Date(), actualDurationSeconds },
    });
    await tx.mission.update({
      where: { id: mId },
      data: { tCountStatus: "COUNTING", holdOffsetSeconds: { increment: actualDurationSeconds } },
    });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mId,
        eventType: MissionHistoryEventType.HOLD_RELEASED,
        actorId: req.user!.id,
        notes: `Hold released after ${actualDurationSeconds}s`,
        metadata: { holdId: hold.id, actualDurationSeconds },
      },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "HOLD_RELEASED", targetType: "Mission", targetId: mId, metadata: { holdId: hold.id, actualDurationSeconds } });
  broadcastMissionUpdate(mId);
  res.status(204).send();
});

// PAUSE COUNTDOWN - equivalent to Call Hold, offered as its own primary control.
router.post("/pause", requireLaunchDirector, async (req, res) => {
  const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A reason is required to pause the countdown" });

  const result = await callHold(missionId(req), req.user!.id, parsed.data.reason);
  if (!result.ok) return res.status(result.status).json({ error: result.message });
  res.status(201).json(result.hold);
});

// ---------------------------------------------------------------------------
// RECYCLE TO [MARK]
// ---------------------------------------------------------------------------

router.post("/recycle", requireLaunchDirector, async (req, res) => {
  const parsed = z.object({ toMarkSeconds: z.number(), reason: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A target mark and reason are required" });

  const mId = missionId(req);
  const mission = await loadMissionWithHolds(mId);
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (mission.tCountStatus !== "COUNTING") {
    return res.status(400).json({ error: "Test Clock must be actively counting to recycle (release any active hold first)" });
  }

  const currentTMinus = computeTCountSeconds(mission, null);
  if (currentTMinus == null) return res.status(400).json({ error: "Test Clock is not established" });
  if (parsed.data.toMarkSeconds <= currentTMinus) {
    return res.status(400).json({ error: "Recycle target must be earlier in the count (a larger T-minus value) than the current mark" });
  }

  const adjustment = parsed.data.toMarkSeconds - currentTMinus;

  await prisma.$transaction(async (tx) => {
    await tx.mission.update({ where: { id: mId }, data: { holdOffsetSeconds: { increment: Math.round(adjustment) } } });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mId,
        eventType: MissionHistoryEventType.RECYCLED,
        actorId: req.user!.id,
        notes: parsed.data.reason,
        metadata: { toMarkSeconds: parsed.data.toMarkSeconds, fromMarkSeconds: currentTMinus },
      },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "COUNTDOWN_RECYCLED", targetType: "Mission", targetId: mId, metadata: parsed.data });
  broadcastMissionUpdate(mId);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// ESTABLISH ACTUAL LAUNCH TIME (MARK LIFTOFF)
// ---------------------------------------------------------------------------

router.post("/liftoff", requireLaunchDirector, async (req, res) => {
  const parsed = z.object({ timestamp: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mId = missionId(req);
  const mission = await prisma.mission.findUnique({ where: { id: mId } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (!mission.lot) return res.status(400).json({ error: "Test Clock is not established" });

  const liftoffActualTime = parsed.data.timestamp ? new Date(parsed.data.timestamp) : new Date();

  await prisma.$transaction(async (tx) => {
    await tx.mission.update({ where: { id: mId }, data: { liftoffActualTime, tCountStatus: "COMPLETE" } });
    await tx.missionHistoryEvent.create({
      data: { missionId: mId, eventType: MissionHistoryEventType.LIFTOFF_MARKED, actorId: req.user!.id, notes: `Liftoff: ${liftoffActualTime.toISOString()}` },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "LIFTOFF_MARKED", targetType: "Mission", targetId: mId, metadata: { liftoffActualTime } });
  broadcastMissionUpdate(mId);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Milestone sequence generation (Section 6.2.4) + vehicle-specific LCP tag
// (v3.1 Item 3 - generated from a selected VLCP Milestone Template, the
// standard/generic sequence being one such option rather than a separate
// mechanism; v3.1 Item 2 - Reset clears it so a different template can be
// applied)
// ---------------------------------------------------------------------------

const STANDARD_TEMPLATE_ID = "standard";

router.get("/milestones/templates", requireConsole, async (req, res) => {
  const mId = missionId(req);
  const mission = await prisma.mission.findUnique({ where: { id: mId } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  const templates = await prisma.milestoneTemplate.findMany({
    where: { vehicleId: mission.vehicleId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });

  res.json({
    appliedTemplateName: mission.appliedMilestoneTemplateName,
    options: [
      { id: STANDARD_TEMPLATE_ID, name: "Standard Countdown Sequence", itemCount: COUNTDOWN_MILESTONE_SEQUENCE.length },
      ...templates.map((t) => ({ id: t.id, name: t.name, itemCount: t.items.length })),
    ],
  });
});

const generateSchema = z.object({ templateId: z.string().default(STANDARD_TEMPLATE_ID) });

router.post("/milestones/generate", requireLaunchDirector, async (req, res) => {
  const mId = missionId(req);
  const parsed = generateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const existing = await prisma.missionMilestone.count({ where: { missionId: mId } });
  if (existing > 0) {
    return res.status(400).json({ error: "Milestones already exist for this mission - use Reset Countdown Sequence first" });
  }

  const mission = await prisma.mission.findUnique({ where: { id: mId } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  let items: { phase?: string; label: string; responsibleStation?: string; tMinusSeconds: number; sortOrder: number }[];
  let appliedName: string;

  if (parsed.data.templateId === STANDARD_TEMPLATE_ID) {
    items = COUNTDOWN_MILESTONE_SEQUENCE;
    appliedName = "Standard Countdown Sequence";
  } else {
    const template = await prisma.milestoneTemplate.findUnique({
      where: { id: parsed.data.templateId },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    if (!template || template.vehicleId !== mission.vehicleId) {
      return res.status(400).json({ error: "Template not found or not associated with this mission's vehicle" });
    }
    items = template.items.map((i) => ({ label: i.label, tMinusSeconds: i.tMinusSeconds, sortOrder: i.sortOrder }));
    appliedName = template.name;
  }

  await prisma.$transaction([
    prisma.missionMilestone.createMany({ data: items.map((item) => ({ missionId: mId, ...item })) }),
    prisma.mission.update({ where: { id: mId }, data: { appliedMilestoneTemplateName: appliedName } }),
  ]);
  broadcastMissionUpdate(mId);
  res.status(201).json({ created: items.length, appliedTemplateName: appliedName });
});

router.post("/milestones/reset", requireLaunchDirector, async (req, res) => {
  const mId = missionId(req);
  const mission = await prisma.mission.findUnique({ where: { id: mId } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  await prisma.$transaction([
    prisma.missionMilestone.deleteMany({ where: { missionId: mId } }),
    prisma.mission.update({ where: { id: mId }, data: { appliedMilestoneTemplateName: null } }),
    prisma.missionHistoryEvent.create({
      data: {
        missionId: mId,
        eventType: MissionHistoryEventType.NOTE,
        actorId: req.user!.id,
        notes: `Countdown milestone sequence reset (was: ${mission.appliedMilestoneTemplateName ?? "none"})`,
      },
    }),
  ]);

  await recordAudit({ userId: req.user!.id, action: "COUNTDOWN_SEQUENCE_RESET", targetType: "Mission", targetId: mId });
  broadcastMissionUpdate(mId);
  res.status(204).send();
});

export default router;
