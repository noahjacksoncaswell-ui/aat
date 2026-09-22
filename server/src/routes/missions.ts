import { Router } from "express";
import { z } from "zod";
import { MissionStatus, MissionHistoryEventType, GoNoGoStatus, MilestoneStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireLaunchDirector, requireRole } from "../middleware/auth";
import { Role } from "@prisma/client";
import { recordAudit } from "../services/audit";
import { isSameUtcDate, isTodayOrPast, STANDARD_GO_NO_GO_STATIONS, FAA_STATION_NAME } from "../services/missionWorkflow";
import { REQUIRED_NOTIFICATION_TYPES } from "../services/faa";
import { broadcastMissionUpdate } from "../websocket";
import { storage } from "../services/storage";

const router = Router();
const requireConsole = requireRole(Role.ADMIN, Role.LAUNCH_DIRECTOR, Role.OPERATOR);

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

router.get("/", async (req, res) => {
  const { site, status, vehicleId, search, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

  const where: any = {};
  if (site) where.siteId = site;
  if (status) where.status = status;
  if (vehicleId) where.vehicleId = vehicleId;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { designator: { contains: search, mode: "insensitive" } },
    ];
  }
  if (dateFrom || dateTo) {
    where.launchPeriodEntries = {
      some: {
        date: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo) } : {}),
        },
      },
    };
  }

  const missions = await prisma.mission.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: {
      vehicle: true,
      site: true,
      launchPeriodEntries: { orderBy: { date: "asc" } },
    },
  });
  res.json(missions);
});

router.get("/:id", async (req, res) => {
  const mission = await prisma.mission.findUnique({
    where: { id: req.params.id },
    include: {
      vehicle: true,
      site: true,
      launchPeriodEntries: { orderBy: { date: "asc" } },
      historyEvents: { orderBy: { timestamp: "desc" }, include: { actor: { select: { id: true, name: true } } } },
      disposition: { include: { addenda: { orderBy: { timestamp: "asc" }, include: { author: { select: { id: true, name: true } } } } } },
      milestones: { orderBy: { sortOrder: "asc" } },
      goNoGoPolls: true,
      logEntries: { orderBy: { timestamp: "desc" }, include: { author: { select: { id: true, name: true } } } },
      notamFilings: { orderBy: { createdAt: "desc" } },
      launchDayNotifications: true,
      assignedUsers: { include: { user: { select: { id: true, name: true, role: true } } } },
      holds: { orderBy: { createdAt: "asc" }, include: { enteredBy: { select: { id: true, name: true } } } },
    },
  });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  res.json(mission);
});

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

const launchPeriodEntrySchema = z.object({
  date: z.string(),
  windowOpen: z.string(),
  windowClose: z.string(),
});

const createMissionSchema = z.object({
  name: z.string().min(1),
  designator: z.string().min(1),
  vehicleId: z.string(),
  siteId: z.string(),
  payloadDescription: z.string().optional().nullable(),
  launchPeriodEntries: z.array(launchPeriodEntrySchema).min(1),
  milestoneTemplateId: z.string().optional(),
});

router.post("/", requireLaunchDirector, async (req, res) => {
  const parsed = createMissionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { launchPeriodEntries, milestoneTemplateId, ...rest } = parsed.data;

  const mission = await prisma.mission.create({
    data: {
      ...rest,
      launchPeriodEntries: {
        create: launchPeriodEntries.map((e) => ({
          date: new Date(e.date),
          windowOpen: new Date(e.windowOpen),
          windowClose: new Date(e.windowClose),
        })),
      },
      goNoGoPolls: { create: STANDARD_GO_NO_GO_STATIONS.map((stationName) => ({ stationName })) },
    },
    include: { launchPeriodEntries: true },
  });

  if (milestoneTemplateId) {
    const template = await prisma.milestoneTemplate.findUnique({ where: { id: milestoneTemplateId }, include: { items: true } });
    if (template) {
      await prisma.missionMilestone.createMany({
        data: template.items.map((item) => ({
          missionId: mission.id,
          label: item.label,
          tMinusSeconds: item.tMinusSeconds,
          sortOrder: item.sortOrder,
        })),
      });
    }
  }

  await recordAudit({ userId: req.user!.id, action: "MISSION_CREATED", targetType: "Mission", targetId: mission.id });
  res.status(201).json(mission);
});

const updateMissionSchema = z.object({
  name: z.string().min(1).optional(),
  payloadDescription: z.string().optional().nullable(),
  vehicleId: z.string().optional(),
  siteId: z.string().optional(),
});

router.patch("/:id", requireLaunchDirector, async (req, res) => {
  const parsed = updateMissionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const mission = await prisma.mission.update({ where: { id: req.params.id }, data: parsed.data });
  await recordAudit({ userId: req.user!.id, action: "MISSION_UPDATED", targetType: "Mission", targetId: mission.id, metadata: parsed.data });
  broadcastMissionUpdate(mission.id);
  res.json(mission);
});

// ---------------------------------------------------------------------------
// Launch period entries
// ---------------------------------------------------------------------------

router.post("/:id/launch-period", requireLaunchDirector, async (req, res) => {
  const parsed = launchPeriodEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mission = await prisma.mission.findUnique({ where: { id: req.params.id } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (([MissionStatus.CANCELLED, MissionStatus.SUCCESSFUL] as MissionStatus[]).includes(mission.status)) {
    return res.status(400).json({ error: `Cannot add a launch period entry to a mission that is already ${mission.status}` });
  }

  const [entry] = await prisma.$transaction([
    prisma.launchPeriodEntry.create({
      data: {
        missionId: req.params.id,
        date: new Date(parsed.data.date),
        windowOpen: new Date(parsed.data.windowOpen),
        windowClose: new Date(parsed.data.windowClose),
      },
    }),
    // Section 3.2 - defining a new window after an indefinite postpone
    // returns the mission to Pending Window.
    ...(mission.status === MissionStatus.POSTPONED
      ? [prisma.mission.update({ where: { id: mission.id }, data: { status: MissionStatus.PENDING_WINDOW } })]
      : []),
  ]);

  await recordAudit({ userId: req.user!.id, action: "LAUNCH_PERIOD_ENTRY_ADDED", targetType: "Mission", targetId: req.params.id });
  broadcastMissionUpdate(req.params.id);
  res.status(201).json(entry);
});

router.delete("/:id/launch-period/:entryId", requireLaunchDirector, async (req, res) => {
  const entry = await prisma.launchPeriodEntry.findUnique({ where: { id: req.params.entryId } });
  if (!entry || entry.missionId !== req.params.id) return res.status(404).json({ error: "Entry not found" });
  if (entry.isTargeted) return res.status(400).json({ error: "Cannot remove the currently targeted launch opportunity" });
  await prisma.launchPeriodEntry.delete({ where: { id: entry.id } });
  broadcastMissionUpdate(req.params.id);
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Launch Director actions (Section 6.3) - server-side gated to Admin/Launch Director
// ---------------------------------------------------------------------------

const targetSchema = z.object({ launchPeriodEntryId: z.string() });

router.post("/:id/actions/target", requireLaunchDirector, async (req, res) => {
  const parsed = targetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mission = await prisma.mission.findUnique({ where: { id: req.params.id } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (([MissionStatus.SCRUBBED, MissionStatus.CANCELLED, MissionStatus.SUCCESSFUL] as MissionStatus[]).includes(mission.status)) {
    return res.status(400).json({ error: `Cannot target a launch opportunity while mission is ${mission.status}` });
  }

  const entry = await prisma.launchPeriodEntry.findUnique({ where: { id: parsed.data.launchPeriodEntryId } });
  if (!entry || entry.missionId !== mission.id) return res.status(404).json({ error: "Launch period entry not found" });
  if (entry.consumed) return res.status(400).json({ error: "This launch opportunity has already been used" });

  await prisma.$transaction(async (tx) => {
    await tx.launchPeriodEntry.updateMany({ where: { missionId: mission.id }, data: { isTargeted: false } });
    await tx.launchPeriodEntry.update({ where: { id: entry.id }, data: { isTargeted: true } });
    await tx.mission.update({ where: { id: mission.id }, data: { status: MissionStatus.TARGETED } });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.TARGETED,
        actorId: req.user!.id,
        relatedLaunchPeriodEntryId: entry.id,
        notes: `Targeted ${entry.date.toISOString().slice(0, 10)} window ${entry.windowOpen.toISOString()}-${entry.windowClose.toISOString()}`,
      },
    });
    // Ensure the three mandatory FAA launch-day notification checklist items exist.
    for (const notificationType of REQUIRED_NOTIFICATION_TYPES) {
      await tx.launchDayNotification.upsert({
        where: { missionId_notificationType: { missionId: mission.id, notificationType: notificationType as any } },
        update: {},
        create: { missionId: mission.id, notificationType: notificationType as any },
      });
    }
    // Reset the GO/NO-GO poll for the new attempt.
    await tx.goNoGoPoll.updateMany({ where: { missionId: mission.id }, data: { status: GoNoGoStatus.UNPOLLED, notes: null } });
  });

  await recordAudit({ userId: req.user!.id, action: "MISSION_TARGETED", targetType: "Mission", targetId: mission.id, metadata: { launchPeriodEntryId: entry.id } });
  broadcastMissionUpdate(mission.id);
  res.status(204).send();
});

const reasonSchema = z.object({ notes: z.string().min(1) });

// Section 3.2 - Postpone Indefinitely. Voids ALL currently defined Launch
// Period entries (not just the targeted one) - the mission returns to a
// state with no defined launch windows at all, and the countdown reference
// (LOT/T-COUNT/P-COUNT) resets. New Launch Period entries may be added
// afterward, which is what returns the mission to Pending Window.
router.post("/:id/actions/postpone", requireLaunchDirector, async (req, res) => {
  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A reason/notes field is required" });

  const mission = await prisma.mission.findUnique({ where: { id: req.params.id }, include: { launchPeriodEntries: true } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (([MissionStatus.SCRUBBED, MissionStatus.SUCCESSFUL, MissionStatus.CANCELLED] as MissionStatus[]).includes(mission.status)) {
    return res.status(400).json({ error: `Cannot postpone a mission that is already ${mission.status}` });
  }
  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  if (targeted && isTodayOrPast(targeted.date)) {
    return res.status(400).json({ error: "Postpone is only available before the day of the targeted opportunity; use Scrub instead" });
  }

  const voided = mission.launchPeriodEntries.filter((e) => !e.consumed);

  await prisma.$transaction(async (tx) => {
    await tx.launchPeriodEntry.updateMany({
      where: { missionId: mission.id, consumed: false },
      data: { isTargeted: false, consumed: true },
    });
    await tx.mission.update({
      where: { id: mission.id },
      data: {
        status: MissionStatus.POSTPONED,
        lot: null,
        lotSubmittedAt: null,
        tCountStatus: "PENDING",
        holdOffsetSeconds: 0,
        liftoffActualTime: null,
      },
    });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.POSTPONED,
        actorId: req.user!.id,
        notes: parsed.data.notes,
        metadata: { voidedEntryIds: voided.map((e) => e.id), voidedCount: voided.length },
      },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "MISSION_POSTPONED_INDEFINITE", targetType: "Mission", targetId: mission.id, metadata: parsed.data });
  broadcastMissionUpdate(mission.id);
  res.status(204).send();
});

// Section 3.3 - Cancel. Terminal at any status prior to Successful. Requires
// double confirmation: the frontend's second confirmation step, and here a
// server-side match on the mission designator as a genuine (not cosmetic)
// safety gate against an accidental or scripted call.
const cancelSchema = z.object({ notes: z.string().min(1), confirmDesignator: z.string().min(1) });

router.post("/:id/actions/cancel", requireLaunchDirector, async (req, res) => {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A reason/notes field and confirmation designator are required" });

  const mission = await prisma.mission.findUnique({ where: { id: req.params.id } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (([MissionStatus.CANCELLED, MissionStatus.SUCCESSFUL] as MissionStatus[]).includes(mission.status)) {
    return res.status(400).json({ error: `Cannot cancel a mission that is already ${mission.status}` });
  }
  if (parsed.data.confirmDesignator.trim().toUpperCase() !== mission.designator.toUpperCase()) {
    return res.status(400).json({ error: "Confirmation designator does not match this mission - cancellation not executed" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.mission.update({ where: { id: mission.id }, data: { status: MissionStatus.CANCELLED } });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.CANCELLED,
        actorId: req.user!.id,
        notes: parsed.data.notes,
      },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "MISSION_CANCELLED", targetType: "Mission", targetId: mission.id, metadata: { notes: parsed.data.notes } });
  broadcastMissionUpdate(mission.id);
  res.status(204).send();
});

// Revision Directive v4.0 Section 1.2 - Remove Mission. Additive to, never a
// substitute for, Cancel: only ever available once a mission is already
// CANCELLED, and permanently, irrecoverably deletes the mission and every
// record associated with it (the mission's own history goes with it, which
// is why this is logged to the system-level audit log rather than a
// MissionHistoryEvent). Double confirmation mirrors Cancel's pattern
// (Section 3.3): a typed designator match plus an explicit attestation.
const removeSchema = z.object({ confirmDesignator: z.string().min(1), attested: z.literal(true) });

router.delete("/:id/actions/remove", requireLaunchDirector, async (req, res) => {
  const parsed = removeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "A matching confirmation designator and the data-integrity attestation are both required" });
  }

  const mission = await prisma.mission.findUnique({ where: { id: req.params.id } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (mission.status !== MissionStatus.CANCELLED) {
    return res.status(400).json({ error: "Remove Mission is only available once a mission has been Cancelled" });
  }
  if (parsed.data.confirmDesignator.trim().toUpperCase() !== mission.designator.toUpperCase()) {
    return res.status(400).json({ error: "Confirmation designator does not match this mission - removal not executed" });
  }

  // Document rows carry an optional missionId (documents may also be scoped
  // to a site or vehicle instead), so unlike every other Mission-owned
  // table there is no onDelete: Cascade on this relation - the documents
  // tagged to this mission, and their underlying stored files, are removed
  // explicitly here before the mission itself is deleted.
  const documents = await prisma.document.findMany({ where: { missionId: mission.id }, include: { versions: true } });
  for (const doc of documents) {
    for (const v of doc.versions) {
      await storage.deleteObject(v.storageKey);
    }
  }

  const { name, designator } = mission;
  await prisma.$transaction([
    prisma.document.deleteMany({ where: { missionId: mission.id } }),
    prisma.mission.delete({ where: { id: mission.id } }),
  ]);

  await recordAudit({
    userId: req.user!.id,
    action: "MISSION_REMOVED",
    targetType: "Mission",
    targetId: mission.id,
    metadata: { designator, name },
  });
  res.status(204).send();
});

// Section 3.4 - Scrub. Only on day-of with a confirmed target. Voids the
// targeted opportunity and atomically resets the countdown reference in the
// same transaction as the scrub itself, so there is no window in which a
// stale T-COUNT/P-COUNT displays against an opportunity that no longer
// exists. Does NOT auto-decide recycle vs. close-out - the mission returns
// to Pending Window and the Launch Director explicitly chooses the
// follow-on path (Select Target Launch Opportunity or Postpone Indefinitely).
router.post("/:id/actions/scrub", requireLaunchDirector, async (req, res) => {
  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A reason/notes field is required" });

  const mission = await prisma.mission.findUnique({ where: { id: req.params.id }, include: { launchPeriodEntries: true } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (mission.status !== MissionStatus.TARGETED) {
    return res.status(400).json({ error: "SCRUB UNAVAILABLE — NO TARGET LAUNCH OPPORTUNITY CONFIRMED" });
  }
  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  if (!targeted) return res.status(400).json({ error: "SCRUB UNAVAILABLE — NO TARGET LAUNCH OPPORTUNITY CONFIRMED" });
  if (!isSameUtcDate(targeted.date, new Date())) {
    return res.status(400).json({ error: "SCRUB UNAVAILABLE — NO TARGET LAUNCH OPPORTUNITY CONFIRMED FOR TODAY" });
  }

  const remaining = mission.launchPeriodEntries.filter((e) => e.id !== targeted.id && !e.consumed);

  await prisma.$transaction(async (tx) => {
    await tx.launchPeriodEntry.update({ where: { id: targeted.id }, data: { isTargeted: false, consumed: true } });
    await tx.mission.update({
      where: { id: mission.id },
      data: {
        status: MissionStatus.PENDING_WINDOW,
        lot: null,
        lotSubmittedAt: null,
        tCountStatus: "PENDING",
        holdOffsetSeconds: 0,
        liftoffActualTime: null,
      },
    });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.SCRUBBED,
        actorId: req.user!.id,
        notes: parsed.data.notes,
        relatedLaunchPeriodEntryId: targeted.id,
        metadata: { remainingOpportunities: remaining.length },
      },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "MISSION_SCRUBBED", targetType: "Mission", targetId: mission.id, metadata: { ...parsed.data, remainingOpportunities: remaining.length } });
  broadcastMissionUpdate(mission.id);
  res.status(200).json({ remainingOpportunities: remaining.length });
});

const dispositionSchema = z.object({
  outcome: z.string().min(1), // Successful / Partial Success / Failure / Anomaly
  actualLiftoffTime: z.string().optional().nullable(),
  flightDurationSeconds: z.number().optional().nullable(),
  apogeeAltitudeAglMeters: z.number().optional().nullable(),
  apogeeAltitudeMslMeters: z.number().optional().nullable(),
  maxVelocityMs: z.number().optional().nullable(),
  maxAccelerationG: z.number().optional().nullable(),
  actualTotalImpulseNs: z.number().optional().nullable(),
  recoveryStatus: z.string().optional().nullable(),
  recoveryLocationLat: z.number().optional().nullable(),
  recoveryLocationLon: z.number().optional().nullable(),
  payloadOutcome: z.string().optional().nullable(),
  anomalySummary: z.string().optional().nullable(),
  anomalyReferenceNote: z.string().optional().nullable(),
  vehiclePerformanceNotes: z.string().optional().nullable(),
  missionNotes: z.string().optional().nullable(),
});

router.post("/:id/actions/disposition", requireLaunchDirector, async (req, res) => {
  const parsed = dispositionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mission = await prisma.mission.findUnique({ where: { id: req.params.id }, include: { launchPeriodEntries: true } });
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if (mission.status !== MissionStatus.TARGETED) {
    return res.status(400).json({ error: "Disposition can only be logged for a mission with a confirmed, targeted launch opportunity" });
  }

  const { actualLiftoffTime, ...rest } = parsed.data;
  // Section 3.5 - the actual liftoff time is established once, by MARK
  // LIFTOFF on the Countdown tab, and is not re-entered here.
  const liftoffTime = actualLiftoffTime ? new Date(actualLiftoffTime) : mission.liftoffActualTime;

  const existing = await prisma.missionDisposition.findUnique({ where: { missionId: mission.id } });

  await prisma.$transaction(async (tx) => {
    await tx.missionDisposition.upsert({
      where: { missionId: mission.id },
      update: { ...rest, actualLiftoffTime: liftoffTime },
      create: { missionId: mission.id, ...rest, actualLiftoffTime: liftoffTime },
    });
    await tx.mission.update({ where: { id: mission.id }, data: { status: MissionStatus.SUCCESSFUL } });
    const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
    if (targeted) await tx.launchPeriodEntry.update({ where: { id: targeted.id }, data: { consumed: true } });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.SUCCESSFUL,
        actorId: req.user!.id,
        notes: existing ? "Disposition record revised" : "Disposition logged",
        metadata: rest as any,
      },
    });
  });

  await recordAudit({ userId: req.user!.id, action: "MISSION_DISPOSITION_LOGGED", targetType: "Mission", targetId: mission.id });
  broadcastMissionUpdate(mission.id);
  res.status(204).send();
});

// Corrections to a logged disposition are appended, never overwrite the
// original record (Section 3.5).
router.post("/:id/disposition/addenda", requireLaunchDirector, async (req, res) => {
  const schema = z.object({ text: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "text is required" });

  const disposition = await prisma.missionDisposition.findUnique({ where: { missionId: req.params.id } });
  if (!disposition) return res.status(404).json({ error: "No disposition on file for this mission" });

  const addendum = await prisma.missionDispositionAddendum.create({
    data: { dispositionId: disposition.id, authorId: req.user!.id, text: parsed.data.text },
    include: { author: { select: { id: true, name: true } } },
  });
  await recordAudit({ userId: req.user!.id, action: "DISPOSITION_ADDENDUM_ADDED", targetType: "Mission", targetId: req.params.id });
  broadcastMissionUpdate(req.params.id);
  res.status(201).json(addendum);
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

router.patch("/:id/milestones/:milestoneId", requireConsole, async (req, res) => {
  const schema = z.object({
    status: z.nativeEnum(MilestoneStatus).optional(),
    actualTime: z.string().optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const milestone = await prisma.missionMilestone.update({
    where: { id: req.params.milestoneId },
    data: {
      ...(parsed.data.status ? { status: parsed.data.status as any } : {}),
      ...(parsed.data.actualTime !== undefined ? { actualTime: parsed.data.actualTime ? new Date(parsed.data.actualTime) : null } : {}),
    },
  });
  broadcastMissionUpdate(req.params.id);
  res.json(milestone);
});

router.post("/:id/milestones", requireLaunchDirector, async (req, res) => {
  const schema = z.object({ label: z.string().min(1), tMinusSeconds: z.number(), sortOrder: z.number().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const milestone = await prisma.missionMilestone.create({
    data: { missionId: req.params.id, ...parsed.data, sortOrder: parsed.data.sortOrder ?? 0 },
  });
  broadcastMissionUpdate(req.params.id);
  res.status(201).json(milestone);
});

// ---------------------------------------------------------------------------
// GO/NO-GO poll
// ---------------------------------------------------------------------------

router.patch("/:id/gonogo/:pollId", requireConsole, async (req, res) => {
  const schema = z.object({ status: z.nativeEnum(GoNoGoStatus), notes: z.string().optional().nullable() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const poll = await prisma.goNoGoPoll.findUnique({ where: { id: req.params.pollId } });
  if (!poll || poll.missionId !== req.params.id) return res.status(404).json({ error: "Poll station not found" });

  if (poll.stationName === FAA_STATION_NAME && parsed.data.status === GoNoGoStatus.GO) {
    const checklist = await prisma.launchDayNotification.findMany({ where: { missionId: req.params.id } });
    const allSatisfied =
      checklist.length === REQUIRED_NOTIFICATION_TYPES.length &&
      checklist.every((item) => item.satisfied || item.notApplicable);
    if (!allSatisfied) {
      return res.status(400).json({
        error: "FAA/Airspace cannot show GO until the launch-day notification checklist is fully satisfied",
      });
    }
  }

  const updated = await prisma.goNoGoPoll.update({
    where: { id: poll.id },
    data: { status: parsed.data.status, notes: parsed.data.notes, updatedById: req.user!.id },
  });
  broadcastMissionUpdate(req.params.id);
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Mission log
// ---------------------------------------------------------------------------

router.post("/:id/log", requireConsole, async (req, res) => {
  const schema = z.object({ text: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const entry = await prisma.missionLogEntry.create({
    data: { missionId: req.params.id, authorId: req.user!.id, text: parsed.data.text },
    include: { author: { select: { id: true, name: true } } },
  });
  broadcastMissionUpdate(req.params.id);
  res.status(201).json(entry);
});

// ---------------------------------------------------------------------------
// Assigned personnel
// ---------------------------------------------------------------------------

router.put("/:id/personnel", requireLaunchDirector, async (req, res) => {
  const schema = z.object({ assignments: z.array(z.object({ userId: z.string(), role: z.string().optional() })) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await prisma.$transaction([
    prisma.userMissionAssignment.deleteMany({ where: { missionId: req.params.id } }),
    prisma.userMissionAssignment.createMany({
      data: parsed.data.assignments.map((a) => ({ missionId: req.params.id, userId: a.userId, role: a.role })),
    }),
  ]);
  res.status(204).send();
});

export default router;
