import { Router } from "express";
import { z } from "zod";
import { MissionRole, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { broadcastMissionUpdate } from "../websocket";
import { computeProjectedLiftoff } from "../services/countdown";
import { POLL_ITEM_CATALOG, computeUnsatisfiedItems, getPollItemDef } from "../services/pollItems";

// v7.1 Section 3 - Launch Status Check (role-owned polls). Replaces the
// flat GoNoGoPoll list's role on the Polls tab; that model, its routes,
// and Range Ops Display's existing summary of it are left untouched -
// out of this directive's explicit scope.
const router = Router({ mergeParams: true });

function missionId(req: any): string {
  return (req.params as { missionId: string }).missionId;
}

async function loadMissionForPolls(mId: string) {
  return prisma.mission.findUnique({
    where: { id: mId },
    include: {
      launchPeriodEntries: true,
      holds: { orderBy: { holdMarkSeconds: "desc" } },
      notamFilings: { orderBy: { createdAt: "desc" }, take: 1 },
      launchDayNotifications: true,
      launchCountTimeConfirmedBy: { select: { id: true, name: true } },
    },
  });
}
type MissionForPolls = NonNullable<Awaited<ReturnType<typeof loadMissionForPolls>>>;

// Section 3.5 - Airspace's computed value: UNPOLLED more than 24h out;
// otherwise GO only once the NOTAM filing, T-60, and T-15 notifications
// are all complete (Termination is deliberately excluded from this check).
function computeAirspaceStatus(mission: MissionForPolls, now: Date): "UNPOLLED" | "GO" | "NO_GO" {
  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  if (!targeted) return "UNPOLLED";
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (targeted.windowOpen > in24h) return "UNPOLLED";

  const { notamFiled, t60Complete, t15Complete } = airspaceChecklist(mission);
  return notamFiled && t60Complete && t15Complete ? "GO" : "NO_GO";
}

function airspaceChecklist(mission: MissionForPolls) {
  const t60 = mission.launchDayNotifications.find((n) => n.notificationType === "T_MINUS_60");
  const t15 = mission.launchDayNotifications.find((n) => n.notificationType === "T_MINUS_15");
  return {
    notamFiled: !!mission.notamFilings[0]?.filedDate,
    t60Complete: !!t60 && (t60.satisfied || t60.notApplicable),
    t15Complete: !!t15 && (t15.satisfied || t15.notApplicable),
  };
}

function sameMinuteUtc(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate() &&
    a.getUTCHours() === b.getUTCHours() &&
    a.getUTCMinutes() === b.getUTCMinutes()
  );
}

// Accepts "1432", "14:32", "14:32:00" (seconds ignored - confirmation is
// to the minute, matching a realistic verbal callout/readback precision).
function parseZuluTimeToMinutes(input: string): number | null {
  const cleaned = input.trim().toUpperCase().replace(/Z$/, "").replace(/:/g, "");
  const digits = cleaned.slice(0, 4);
  if (!/^\d{3,4}$/.test(digits)) return null;
  const padded = digits.padStart(4, "0");
  const hours = parseInt(padded.slice(0, 2), 10);
  const minutes = parseInt(padded.slice(2, 4), 10);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// v7.1.1 - the single source of truth for Launch Status Check state,
// shared by every route below (GET /, the item-set/override routes' lock
// check, and the launch-count-time route's readiness gate) so the
// sequential-gating and post-completion-lock rules can never drift
// between the read path and the write paths that must enforce them.
async function computeLscState(mission: MissionForPolls, now: Date = new Date()) {
  const storedItems = await prisma.pollItem.findMany({
    where: { missionId: mission.id },
    include: { updatedBy: { select: { id: true, name: true } } },
  });

  const items = POLL_ITEM_CATALOG.map((def) => {
    const stored = storedItems.find((s) => s.itemKey === def.key);
    const status = def.computed ? (stored ? stored.status : computeAirspaceStatus(mission, now)) : (stored?.status ?? "UNPOLLED");
    return {
      key: def.key,
      box: def.box,
      label: def.label,
      status,
      isOverridden: def.computed ? !!stored : false,
      updatedByName: stored?.updatedBy?.name ?? null,
      updatedAt: stored?.updatedAt ?? null,
    };
  });

  // Section 1, step 1 - every item, LWCC excluded (it isn't in the
  // catalog at all - it's a pure live readout, never a stored PollItem).
  const notGoItems = computeUnsatisfiedItems(items);
  const readiness = { allGo: notGoItems.length === 0, notGoItems };

  const projectedLiftoff = computeProjectedLiftoff(mission, mission.holds, now);
  const timeConfirmed =
    !!mission.launchCountTimeConfirmedValue && !!projectedLiftoff && sameMinuteUtc(mission.launchCountTimeConfirmedValue, projectedLiftoff);

  // Section 1, step 3 - the time confirmation is the actual completion
  // trigger, not Final Launch Status alone; readiness.allGo (which
  // already includes LD_FINAL_LAUNCH_STATUS) is a prerequisite for it.
  const isGo = readiness.allGo && timeConfirmed;
  const ldItem = items.find((i) => i.key === "LD_FINAL_LAUNCH_STATUS")!;
  const completedAt = isGo
    ? new Date(
        Math.max(new Date(ldItem.updatedAt ?? 0).getTime(), (mission.launchCountTimeConfirmedAt ?? new Date(0)).getTime())
      ).toISOString()
    : null;

  return {
    items,
    readiness,
    launchCountTime: {
      confirmed: timeConfirmed,
      confirmedAt: mission.launchCountTimeConfirmedAt,
      confirmedByName: mission.launchCountTimeConfirmedBy?.name ?? null,
      projectedLiftoff,
    },
    completion: { isGo, completedAt },
  };
}

router.get("/", async (req, res) => {
  const mission = await loadMissionForPolls(missionId(req));
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  const state = await computeLscState(mission);
  res.json({ ...state, airspaceChecklist: airspaceChecklist(mission) });
});

router.get("/history", async (req, res) => {
  const entries = await prisma.pollAuditEntry.findMany({
    where: { missionId: missionId(req) },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { timestamp: "desc" },
    take: 200,
  });
  res.json(
    entries.map((e) => ({
      id: e.id,
      itemKey: e.itemKey,
      previousValue: e.previousValue,
      newValue: e.newValue,
      isOverride: e.isOverride,
      actorName: e.actor.name,
      timestamp: e.timestamp,
    }))
  );
});

async function setPollItemValue(params: { missionId: string; itemKey: string; newValue: string; actorId: string; isOverride: boolean }) {
  const { missionId: mId, itemKey, newValue, actorId, isOverride } = params;
  const existing = await prisma.pollItem.findUnique({ where: { missionId_itemKey: { missionId: mId, itemKey } } });
  const previousValue = existing?.status ?? "UNPOLLED";

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.pollItem.upsert({
      where: { missionId_itemKey: { missionId: mId, itemKey } },
      update: { status: newValue, updatedById: actorId },
      create: { missionId: mId, itemKey, status: newValue, updatedById: actorId },
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    await tx.pollAuditEntry.create({ data: { missionId: mId, itemKey, previousValue, newValue, isOverride, actorId } });
    return item;
  });
  broadcastMissionUpdate(mId);
  return updated;
}

const launchCountTimeSchema = z.object({ enteredTimeZulu: z.string().min(1) });

// Section 3.6 - the LD's callout-and-readback confirmation of the Launch
// Clock's current projected liftoff time. Registered before POST
// /:itemKey below - Express matches routes in definition order, and
// "/:itemKey" would otherwise swallow "/launch-count-time" as if it were
// an itemKey (and 404 as "Unknown poll item").
router.post("/launch-count-time", async (req, res) => {
  const parsed = launchCountTimeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const mId = missionId(req);
  const mission = await loadMissionForPolls(mId);
  if (!mission) return res.status(404).json({ error: "Mission not found" });

  const actor = req.user!;
  const isAdmin = actor.role === Role.ADMIN;
  const assignment = await prisma.missionPersonnelAssignment.findFirst({ where: { missionId: mId, role: MissionRole.LD } });
  const isAssignedLd = assignment?.userId === actor.id;
  if (!isAssignedLd && !isAdmin) {
    return res.status(403).json({ error: "Only the assigned Launch Director (or an Admin) may confirm the Launch Count Time." });
  }

  // v7.1.1 Section 2 - once the LSC is already complete, nothing (this
  // included) may change it.
  const priorState = await computeLscState(mission);
  if (priorState.completion.isGo) {
    return res.status(409).json({ error: "The Launch Status Check is already complete. No further changes are permitted." });
  }

  // v7.1.1 Section 1, step 4 - defense in depth: the frontend disables
  // this control until every item is GO (step 2), but the server rejects
  // it too regardless of how the request was made.
  if (!priorState.readiness.allGo) {
    return res.status(409).json({
      error: `LAUNCH STATUS CHECK BLOCKED — THE FOLLOWING ITEMS ARE NOT GO: ${priorState.readiness.notGoItems.join(", ")}`,
    });
  }

  const projectedLiftoff = computeProjectedLiftoff(mission, mission.holds);
  if (!projectedLiftoff) {
    return res.status(400).json({ error: "The Launch Clock has no projected liftoff time to confirm against yet." });
  }

  const enteredMinutes = parseZuluTimeToMinutes(parsed.data.enteredTimeZulu);
  if (enteredMinutes == null) {
    return res.status(400).json({ error: "Enter the time as HHMM or HH:MM, Zulu." });
  }
  const actualMinutes = projectedLiftoff.getUTCHours() * 60 + projectedLiftoff.getUTCMinutes();
  if (enteredMinutes !== actualMinutes) {
    const actualHH = String(projectedLiftoff.getUTCHours()).padStart(2, "0");
    const actualMM = String(projectedLiftoff.getUTCMinutes()).padStart(2, "0");
    return res.status(400).json({
      error: `Entered time does not match the Launch Clock's current projected liftoff (${actualHH}:${actualMM} Zulu). Confirmation not accepted.`,
    });
  }

  const updated = await prisma.mission.update({
    where: { id: mId },
    data: { launchCountTimeConfirmedValue: projectedLiftoff, launchCountTimeConfirmedAt: new Date(), launchCountTimeConfirmedById: actor.id },
    include: { launchCountTimeConfirmedBy: { select: { id: true, name: true } } },
  });
  await prisma.pollAuditEntry.create({
    data: {
      missionId: mId,
      itemKey: "LD_LAUNCH_COUNT_TIME",
      previousValue: null,
      newValue: projectedLiftoff.toISOString(),
      isOverride: isAdmin && !isAssignedLd,
      actorId: actor.id,
    },
  });
  broadcastMissionUpdate(mId);
  res.json({
    confirmed: true,
    confirmedAt: updated.launchCountTimeConfirmedAt,
    confirmedByName: updated.launchCountTimeConfirmedBy?.name ?? null,
    projectedLiftoff,
  });
});

const setItemSchema = z.object({ status: z.string() });

// Section 3.3-3.6 (all items except RC_AIRSPACE, which has no normal
// "assigned person sets it" path - see below) and Section 3.7's Admin
// Override, unified into one endpoint: the difference between a normal
// set and an override is only who the actor is, not a different action.
router.post("/:itemKey", async (req, res) => {
  const def = getPollItemDef(req.params.itemKey);
  if (!def) return res.status(404).json({ error: "Unknown poll item" });

  const parsed = setItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!def.allowedValues.includes(parsed.data.status)) {
    return res.status(400).json({ error: `Invalid status for ${def.key}. Allowed: ${def.allowedValues.join(", ")}` });
  }

  const mId = missionId(req);
  const actor = req.user!;
  const isAdmin = actor.role === Role.ADMIN;

  // v7.1.1 Section 2 - post-completion lock: once the LSC is complete, no
  // item may change, by anyone, including Admin Override.
  const mission = await loadMissionForPolls(mId);
  if (!mission) return res.status(404).json({ error: "Mission not found" });
  if ((await computeLscState(mission)).completion.isGo) {
    return res.status(409).json({ error: "The Launch Status Check is already complete. No further changes are permitted." });
  }

  if (def.computed) {
    if (!isAdmin) return res.status(403).json({ error: "Airspace is computed automatically from the NOTAM/T-60/T-15 checklist; only an Admin may override it." });
    const updated = await setPollItemValue({ missionId: mId, itemKey: def.key, newValue: parsed.data.status, actorId: actor.id, isOverride: true });
    return res.json({ key: updated.itemKey, status: updated.status, updatedByName: updated.updatedBy?.name ?? null, updatedAt: updated.updatedAt });
  }

  const assignment = await prisma.missionPersonnelAssignment.findFirst({ where: { missionId: mId, role: def.box as MissionRole } });
  const isAssignedHolder = assignment?.userId === actor.id;
  if (!isAssignedHolder && !isAdmin) {
    return res.status(403).json({ error: `Only the assigned ${def.box} (or an Admin) may set this item.` });
  }

  const updated = await setPollItemValue({
    missionId: mId,
    itemKey: def.key,
    newValue: parsed.data.status,
    actorId: actor.id,
    isOverride: isAdmin && !isAssignedHolder,
  });
  res.json({ key: updated.itemKey, status: updated.status, updatedByName: updated.updatedBy?.name ?? null, updatedAt: updated.updatedAt });
});

// Clears an Admin override on RC_AIRSPACE, reverting it to the live
// computed value. Only RC_AIRSPACE has an override to clear this way -
// every other item's "override" is just a normal set, cleared the same
// way any value is changed (POST a new status).
router.delete("/:itemKey", async (req, res) => {
  const def = getPollItemDef(req.params.itemKey);
  if (!def) return res.status(404).json({ error: "Unknown poll item" });
  if (req.user!.role !== Role.ADMIN) return res.status(403).json({ error: "Admin only" });
  if (!def.computed) return res.status(400).json({ error: "This item has no override to clear; set its value directly." });

  const mId = missionId(req);
  const missionForLock = await loadMissionForPolls(mId);
  if (!missionForLock) return res.status(404).json({ error: "Mission not found" });
  if ((await computeLscState(missionForLock)).completion.isGo) {
    return res.status(409).json({ error: "The Launch Status Check is already complete. No further changes are permitted." });
  }

  const existing = await prisma.pollItem.findUnique({ where: { missionId_itemKey: { missionId: mId, itemKey: def.key } } });
  if (!existing) return res.status(404).json({ error: "No override currently in effect for this item." });

  await prisma.$transaction([
    prisma.pollItem.delete({ where: { id: existing.id } }),
    prisma.pollAuditEntry.create({
      data: { missionId: mId, itemKey: def.key, previousValue: existing.status, newValue: "(reverted to computed)", isOverride: true, actorId: req.user!.id },
    }),
  ]);
  broadcastMissionUpdate(mId);
  res.status(204).send();
});

export default router;
