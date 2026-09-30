import { prisma } from "../lib/prisma";
import { computeProjectedLiftoff } from "./countdown";
import { POLL_ITEM_CATALOG, computeUnsatisfiedItems } from "./pollItems";

// v7.1.1 - extracted from routes/missionPolls.ts by v9.4 Section 1 so the
// LSC Verification Error Hold gate (services/holdScheduler.ts) can reuse
// this EXACT completion computation rather than a second, parallel check
// that could disagree with the real LSC state the Polls tab/Range Ops
// Display/CCS tab all read. This is the single source of truth for
// "has the Launch Status Check completed" - every route and gate that
// needs that answer calls computeLscState, never re-derives it.

export async function loadMissionForLscState(mId: string) {
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
export type MissionForLscState = NonNullable<Awaited<ReturnType<typeof loadMissionForLscState>>>;

// Section 3.5 - Airspace's computed value: UNPOLLED more than 24h out;
// otherwise GO only once the NOTAM filing, T-60, and T-15 notifications
// are all complete (Termination is deliberately excluded from this check).
function computeAirspaceStatus(mission: MissionForLscState, now: Date): "UNPOLLED" | "GO" | "NO_GO" {
  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  if (!targeted) return "UNPOLLED";
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (targeted.windowOpen > in24h) return "UNPOLLED";

  const { notamFiled, t60Complete, t15Complete } = airspaceChecklist(mission);
  return notamFiled && t60Complete && t15Complete ? "GO" : "NO_GO";
}

export function airspaceChecklist(mission: MissionForLscState) {
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

// v7.1.1 - the single source of truth for Launch Status Check state,
// shared by every route (GET /polls, the item-set/override routes' lock
// check, the launch-count-time route's readiness gate) and, since v9.4,
// the LSC Verification Error Hold scheduler gate - so completion can
// never be computed two different ways in two different places.
export async function computeLscState(mission: MissionForLscState, now: Date = new Date()) {
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
      shortLabel: def.shortLabel ?? def.label,
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
