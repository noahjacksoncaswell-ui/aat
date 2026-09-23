import { Mission, MissionHold, MissionHistoryEventType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { broadcastMissionUpdate } from "../websocket";
import { computeTCountSeconds } from "./countdown";
import { COFR_DOCUMENT_CATEGORY } from "./lotCertification";

/**
 * Revision Directive v4.1 Item 1 [BLOCKING] - the previous hold-trigger
 * mechanism only ran inside a client-side useEffect in CountdownTab.tsx,
 * so a programmed hold's mark was only detected while that specific
 * component happened to be mounted in some browser. Test Clock could run
 * straight through a hold's mark with nobody's Countdown tab open (or the
 * mounted client missing the exact tick, per the v4.1 field report), and
 * the hold would only be discovered - late - on the next page mount.
 *
 * This is the fix: a server-side, always-running scheduler that is the
 * sole source of truth for hold triggering and Item 2's Auto-Proceed
 * auto-release, independent of any connected client. It ticks every
 * second, finds every mission whose Test Clock is live (COUNTING or
 * HOLDING), and:
 *   - COUNTING: triggers the next SCHEDULED hold whose mark has been
 *     reached (freezing Test Clock), exactly mirroring the logic the old
 *     client-driven POST /holds/:holdId/trigger endpoint used to perform
 *     only on demand.
 *   - HOLDING: if the active hold is a PROGRAMMED hold with autoProceed
 *     enabled and its estimated duration has elapsed, releases it
 *     automatically (Item 2).
 * Either action broadcasts a mission update over the websocket so every
 * connected client - whoever is looking at the Countdown tab, the
 * persistent clock header on any other tab, or another user entirely -
 * refetches and reflects the change within about a second, not minutes.
 */

const TICK_MS = 1000;

type MissionWithHolds = Mission & { holds: MissionHold[] };

// Returns true if a hold was triggered, so callers relying on the
// (now-stale) in-memory `mission.holds` snapshot know not to treat the
// mission as still hold-free for the rest of this tick.
async function triggerNextScheduledHold(mission: MissionWithHolds): Promise<boolean> {
  const currentTMinus = computeTCountSeconds(mission, null);
  if (currentTMinus == null) return false;

  // If several marks have somehow all been passed (e.g. the scheduler was
  // down), trigger the one closest to the current mark first - the next
  // one in sequence - not the earliest-scheduled one.
  const eligible = mission.holds
    .filter((h) => h.status === "SCHEDULED" && h.holdMarkSeconds >= currentTMinus)
    .sort((a, b) => a.holdMarkSeconds - b.holdMarkSeconds);
  const hold = eligible[0];
  if (!hold) return false;

  await prisma.$transaction([
    prisma.missionHold.update({ where: { id: hold.id }, data: { status: "ACTIVE", actualStartedAt: new Date() } }),
    prisma.mission.update({ where: { id: mission.id }, data: { tCountStatus: "HOLDING" } }),
    prisma.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.HOLD_CALLED,
        notes: `Programmed hold reached at T-${hold.holdMarkSeconds}s`,
        metadata: { holdId: hold.id },
      },
    }),
  ]);
  broadcastMissionUpdate(mission.id);
  return true;
}

async function maybeAutoReleaseHold(mission: MissionWithHolds): Promise<void> {
  const activeHold = mission.holds.find((h) => h.status === "ACTIVE");
  if (!activeHold || !activeHold.actualStartedAt) return;
  if (activeHold.type !== "PROGRAMMED" || !activeHold.autoProceed) return;
  if (activeHold.estimatedDurationSeconds == null) return;

  const elapsedSeconds = (Date.now() - activeHold.actualStartedAt.getTime()) / 1000;
  if (elapsedSeconds < activeHold.estimatedDurationSeconds) return;

  const actualDurationSeconds = Math.round(elapsedSeconds);
  await prisma.$transaction([
    prisma.missionHold.update({
      where: { id: activeHold.id },
      data: { status: "RELEASED", actualEndedAt: new Date(), actualDurationSeconds },
    }),
    prisma.mission.update({
      where: { id: mission.id },
      data: { tCountStatus: "COUNTING", holdOffsetSeconds: { increment: actualDurationSeconds } },
    }),
    prisma.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.HOLD_RELEASED,
        notes: `Hold auto-released after ${actualDurationSeconds}s (Auto-Proceed)`,
        metadata: { holdId: activeHold.id, actualDurationSeconds, auto: true },
      },
    }),
  ]);
  broadcastMissionUpdate(mission.id);
}

/**
 * v5.0 Section 7.4 - hard procedural gate for LOT Submission certification
 * checkbox 8. If the mission's current LOT was certified on the basis that
 * a CoFR "will be filed" (no CoFR document was on file at submission time)
 * and the 24-hour compliance deadline has now lapsed with still no CoFR
 * document associated with the assigned vehicle, this raises a
 * system-triggered unscheduled hold flagged `isCofrComplianceHold` so it
 * cannot be cleared by the ordinary Release Hold action - only by
 * confirming a CoFR is now on file (POST .../cofr-gate/confirm) or
 * Postpone Indefinitely, per the directive's "must not auto-execute
 * Postpone Indefinitely" / "explicit Launch Director action" requirement.
 *
 * Deliberately no-ops while another hold is already ACTIVE, to preserve
 * the single-active-hold invariant the rest of the countdown system
 * assumes; it re-checks on every subsequent tick, so the gate still fires
 * the instant that hold clears if the deadline has already passed.
 */
async function maybeRaiseCofrComplianceGate(mission: MissionWithHolds): Promise<void> {
  if (mission.holds.some((h) => h.status === "ACTIVE")) return;

  const latestCert = await prisma.lotCertification.findFirst({
    where: { missionId: mission.id, cofrBasis: "WILL_FILE_WITHIN_24H", cofrGateResolvedAt: null },
    orderBy: { signedAt: "desc" },
  });
  if (!latestCert?.cofrComplianceDeadline) return;
  if (Date.now() < latestCert.cofrComplianceDeadline.getTime()) return;

  const cofrDoc = await prisma.document.findFirst({ where: { category: COFR_DOCUMENT_CATEGORY, vehicleId: mission.vehicleId } });
  if (cofrDoc) return; // resolved organically; LD still confirms via cofr-gate/confirm to clear the record

  const currentTMinus = computeTCountSeconds(mission, null) ?? 0;
  const reason =
    "CoFR compliance deadline lapsed - no Certification of Flight Readiness is on file for the assigned vehicle. Per LOT Certification checkbox 8, T-Count is blocked pending Launch Director action.";

  await prisma.$transaction(async (tx) => {
    const hold = await tx.missionHold.create({
      data: {
        missionId: mission.id,
        type: "UNSCHEDULED",
        holdMarkSeconds: Math.round(currentTMinus),
        status: "ACTIVE",
        actualStartedAt: new Date(),
        isCofrComplianceHold: true,
        reason,
      },
    });
    await tx.mission.update({ where: { id: mission.id }, data: { tCountStatus: "HOLDING" } });
    await tx.lotCertification.update({ where: { id: latestCert.id }, data: { cofrGateHoldId: hold.id, cofrGateLapsedAt: new Date() } });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.COFR_COMPLIANCE_LAPSED,
        notes: reason,
        metadata: { holdId: hold.id, certificationId: latestCert.id },
      },
    });
  });
  broadcastMissionUpdate(mission.id);
}

async function tick(): Promise<void> {
  const missions = await prisma.mission.findMany({
    where: { lot: { not: null }, tCountStatus: { in: ["COUNTING", "HOLDING"] } },
    include: { holds: true },
  });

  for (const mission of missions) {
    try {
      if (mission.tCountStatus === "COUNTING") {
        const holdTriggered = await triggerNextScheduledHold(mission);
        if (!holdTriggered) await maybeRaiseCofrComplianceGate(mission);
      } else if (mission.tCountStatus === "HOLDING") {
        await maybeAutoReleaseHold(mission);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`Hold scheduler: tick failed for mission ${mission.id}`, err);
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startHoldScheduler(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    tick().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Hold scheduler: tick error", err);
    });
  }, TICK_MS);
}

export function stopHoldScheduler(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
