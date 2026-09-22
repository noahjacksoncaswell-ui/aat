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
  vehicleReadinessNotes: z.string().optional().nullable(),
  rangeAvailabilityNotes: z.string().optional().nullable(),
  meteorologicalOutlookNotes: z.string().optional().nullable(),
  scheduleConstraintsNotes: z.string().optional().nullable(),
  safetyRegulatoryNotes: z.string().optional().nullable(),
});

function validateLotWindow(lot: Date, targeted: { windowOpen: Date; windowClose: Date } | undefined) {
  if (!targeted) return "Mission has no confirmed Target Launch Opportunity";
  if (lot < targeted.windowOpen || lot > targeted.windowClose) {
    return `Targeted LOT must fall within the confirmed launch window (${targeted.windowOpen.toISOString()} – ${targeted.windowClose.toISOString()})`;
  }
  return null;
}

router.post("/lot", requireLaunchDirector, async (req, res) => {
  const parsed = lotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mission = await loadMissionWithHolds(missionId(req));
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

  // Request/response field names stay unprefixed (matching the frontend
  // form and the wire contract); only the Mission model's columns carry the
  // `lot`-prefix, so the mapping happens here, once, rather than renaming
  // either side of the API.
  const {
    vehicleReadinessNotes,
    rangeAvailabilityNotes,
    meteorologicalOutlookNotes,
    scheduleConstraintsNotes,
    safetyRegulatoryNotes,
  } = parsed.data;

  await prisma.$transaction(async (tx) => {
    await tx.mission.update({
      where: { id: mission.id },
      data: {
        lot,
        lotSubmittedAt: new Date(),
        tCountStatus: "COUNTING",
        holdOffsetSeconds: 0,
        lotVehicleReadinessNotes: vehicleReadinessNotes,
        lotRangeAvailabilityNotes: rangeAvailabilityNotes,
        lotMeteorologicalOutlookNotes: meteorologicalOutlookNotes,
        lotScheduleConstraintsNotes: scheduleConstraintsNotes,
        lotSafetyRegulatoryNotes: safetyRegulatoryNotes,
      },
    });
    await tx.missionHistoryEvent.create({
      data: { missionId: mission.id, eventType: MissionHistoryEventType.LOT_SUBMITTED, actorId: req.user!.id, notes: `LOT established: ${lot.toISOString()}` },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "LOT_SUBMITTED", targetType: "Mission", targetId: mission.id, metadata: { lot } });
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

// Client-driven trigger: fired once the locally-ticking Test Clock crosses a
// SCHEDULED hold's mark. Re-validated server-side before activating.
router.post("/holds/:holdId/trigger", requireConsole, async (req, res) => {
  const mId = missionId(req);
  const mission = await loadMissionWithHolds(mId);
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  const hold = mission.holds.find((h) => h.id === req.params.holdId);
  if (!hold) return res.status(404).json({ error: "Hold not found" });
  if (hold.status !== "SCHEDULED") return res.status(200).json(hold); // idempotent no-op

  const alreadyActive = mission.holds.find((h) => h.status === "ACTIVE");
  if (alreadyActive) return res.status(400).json({ error: "Another hold is already active" });

  const currentTMinus = computeTCountSeconds(mission, null);
  if (currentTMinus == null || currentTMinus > hold.holdMarkSeconds) {
    return res.status(400).json({ error: "Hold mark has not yet been reached" });
  }

  const [updatedHold] = await prisma.$transaction([
    prisma.missionHold.update({ where: { id: hold.id }, data: { status: "ACTIVE", actualStartedAt: new Date() } }),
    prisma.mission.update({ where: { id: mId }, data: { tCountStatus: "HOLDING" } }),
    prisma.missionHistoryEvent.create({
      data: { missionId: mId, eventType: MissionHistoryEventType.HOLD_CALLED, notes: `Programmed hold reached at T-${hold.holdMarkSeconds}s`, metadata: { holdId: hold.id } },
    }),
  ]);
  broadcastMissionUpdate(mId);
  res.json(updatedHold);
});

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
