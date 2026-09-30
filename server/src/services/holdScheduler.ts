import { Mission, MissionHold, MissionHistoryEventType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { broadcastMissionUpdate } from "../websocket";
import {
  computeTCountSeconds,
  TERMINAL_COUNT_DEADLINE_SECONDS,
  TERMINAL_COUNT_AUTO_HOLD_REASON,
  LSC_ERROR_HOLD_GATE_SECONDS,
  LSC_ERROR_HOLD_REASON,
} from "./countdown";
import { COFR_DOCUMENT_CATEGORY } from "./lotCertification";
import { computeLscState, loadMissionForLscState } from "./lscState";

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
async function maybeRaiseCofrComplianceGate(mission: MissionWithHolds): Promise<boolean> {
  if (mission.holds.some((h) => h.status === "ACTIVE")) return false;

  const latestCert = await prisma.lotCertification.findFirst({
    where: { missionId: mission.id, cofrBasis: "WILL_FILE_WITHIN_24H", cofrGateResolvedAt: null },
    orderBy: { signedAt: "desc" },
  });
  if (!latestCert?.cofrComplianceDeadline) return false;
  if (Date.now() < latestCert.cofrComplianceDeadline.getTime()) return false;

  const cofrDoc = await prisma.document.findFirst({ where: { category: COFR_DOCUMENT_CATEGORY, vehicleId: mission.vehicleId } });
  if (cofrDoc) return false; // resolved organically; LD still confirms via cofr-gate/confirm to clear the record

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
  return true;
}

/**
 * v9.3 Section 3.3.3 - CCS Terminal Count Arm gate. ARM TERMINAL COUNT must
 * be actuated by T-03:00:00; if the mission reaches that mark still unarmed,
 * this force-inserts an unscheduled hold flagged `isTerminalCountAutoHold`
 * so it cannot be cleared by the ordinary Release Hold action - only by
 * arming (which POST /terminal-count/arm allows regardless of whether this
 * auto-hold is already active, unlocking Proceed Through Hold for it).
 *
 * Mirrors maybeRaiseCofrComplianceGate's shape: no-ops while another hold
 * is already ACTIVE (single-active-hold invariant) and no-ops once armed,
 * so revoking after the deadline (which clears terminalCountArmedAt) is
 * picked back up on the very next tick and re-raises the same auto-hold -
 * the deadline cannot be escaped by arming, revoking, and not re-arming.
 */
async function maybeRaiseTerminalCountGate(mission: MissionWithHolds): Promise<boolean> {
  if (mission.holds.some((h) => h.status === "ACTIVE")) return false;
  if (mission.terminalCountArmedAt) return false;

  const currentTMinus = computeTCountSeconds(mission, null);
  if (currentTMinus == null || currentTMinus > TERMINAL_COUNT_DEADLINE_SECONDS) return false;

  await prisma.$transaction(async (tx) => {
    const hold = await tx.missionHold.create({
      data: {
        missionId: mission.id,
        type: "UNSCHEDULED",
        holdMarkSeconds: Math.round(currentTMinus),
        status: "ACTIVE",
        actualStartedAt: new Date(),
        isTerminalCountAutoHold: true,
        reason: TERMINAL_COUNT_AUTO_HOLD_REASON,
      },
    });
    await tx.mission.update({ where: { id: mission.id }, data: { tCountStatus: "HOLDING" } });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.TERMINAL_COUNT_AUTO_HOLD,
        notes: `${TERMINAL_COUNT_AUTO_HOLD_REASON} - hold forced at T-${Math.round(currentTMinus)}s`,
        metadata: { holdId: hold.id },
      },
    });
  });
  broadcastMissionUpdate(mission.id);
  return true;
}

/**
 * v9.4 Section 1 - LSC Verification Error Hold: a fixed structural
 * checkpoint at T-10:00:00, independent of whatever discretionary hold the
 * Launch Director may or may not have programmed for the Launch Status
 * Check. Reuses computeLscState (services/lscState.ts) - the exact same
 * completion computation the Polls tab, Range Ops Display, and the CCS
 * tab's own LSC State panel all read - so this gate can never disagree
 * with what those displays are showing.
 *
 * Mirrors the CoFR/Terminal-Count gates' shape (no-ops while another hold
 * is ACTIVE), but its release condition is different and stricter: LSC
 * completion is a one-way, post-completion-locked state (v7.1.1 Section
 * 2), so once this hold releases (only maybeAutoReleaseLscErrorHold does
 * that, and only on LSC completion), `computeLscState(...).completion.isGo`
 * can never revert to false and this function can never fire again for
 * the mission - functionally identical to "evaluated once, at T-10:00:00"
 * per Section 1.2, but implemented as a resilient recurring check (like
 * its sibling gates) so a scheduler restart can never cause it to be
 * silently skipped.
 */
async function maybeRaiseLscErrorHold(mission: MissionWithHolds): Promise<boolean> {
  if (mission.holds.some((h) => h.status === "ACTIVE")) return false;
  // Already raised (and, since resolved, released) at some point - LSC
  // completion is one-way, so it can never need raising again.
  if (mission.holds.some((h) => h.type === "ERROR")) return false;

  const currentTMinus = computeTCountSeconds(mission, null);
  if (currentTMinus == null || currentTMinus > LSC_ERROR_HOLD_GATE_SECONDS) return false;

  const fullMission = await loadMissionForLscState(mission.id);
  if (!fullMission) return false;
  const lsc = await computeLscState(fullMission);
  if (lsc.completion.isGo) return false; // LSC already complete - this hold is never created, no visible trace.

  await prisma.$transaction(async (tx) => {
    const hold = await tx.missionHold.create({
      data: {
        missionId: mission.id,
        type: "ERROR",
        holdMarkSeconds: Math.round(currentTMinus),
        status: "ACTIVE",
        actualStartedAt: new Date(),
        reason: LSC_ERROR_HOLD_REASON,
      },
    });
    await tx.mission.update({ where: { id: mission.id }, data: { tCountStatus: "HOLDING" } });
    await tx.missionHistoryEvent.create({
      data: {
        missionId: mission.id,
        eventType: MissionHistoryEventType.LSC_ERROR_HOLD_RAISED,
        notes: LSC_ERROR_HOLD_REASON,
        metadata: { holdId: hold.id },
      },
    });
  });
  broadcastMissionUpdate(mission.id);
  return true;
}

/**
 * v9.4 Section 1.3 - the ERROR HOLD's only release path: condition-based,
 * the instant LSC's real completion event fires, no button press from
 * anyone. Checked every tick while the ERROR HOLD is active, independent
 * of (and in addition to) maybeAutoReleaseHold above, which only ever
 * touches PROGRAMMED+autoProceed holds and never this one.
 */
async function maybeAutoReleaseLscErrorHold(mission: MissionWithHolds): Promise<void> {
  const activeHold = mission.holds.find((h) => h.status === "ACTIVE" && h.type === "ERROR");
  if (!activeHold || !activeHold.actualStartedAt) return;

  const fullMission = await loadMissionForLscState(mission.id);
  if (!fullMission) return;
  const lsc = await computeLscState(fullMission);
  if (!lsc.completion.isGo) return;

  const actualDurationSeconds = Math.round((Date.now() - activeHold.actualStartedAt.getTime()) / 1000);
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
        eventType: MissionHistoryEventType.LSC_ERROR_HOLD_RESOLVED,
        notes: `LSC completed; ERROR HOLD auto-released after ${actualDurationSeconds}s`,
        metadata: { holdId: activeHold.id, actualDurationSeconds },
      },
    }),
  ]);
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
        if (!holdTriggered) {
          const cofrGateRaised = await maybeRaiseCofrComplianceGate(mission);
          if (!cofrGateRaised) {
            const terminalGateRaised = await maybeRaiseTerminalCountGate(mission);
            if (!terminalGateRaised) await maybeRaiseLscErrorHold(mission);
          }
        }
      } else if (mission.tCountStatus === "HOLDING") {
        await maybeAutoReleaseHold(mission);
        await maybeAutoReleaseLscErrorHold(mission);
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
