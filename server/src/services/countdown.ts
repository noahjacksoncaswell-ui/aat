import { Mission, MissionHold } from "@prisma/client";

// v9.3 Section 3.3.3 - CCS Terminal Count Arm gate: opens at T-10:00:00,
// must be actuated by T-03:00:00 or the scheduler force-inserts a hold
// that only arming itself can release. (v9.5 Section 0 - every T-minus
// reference written to the second.)
export const TERMINAL_COUNT_ARM_OPEN_SECONDS = 600;
export const TERMINAL_COUNT_DEADLINE_SECONDS = 180;
export const TERMINAL_COUNT_AUTO_HOLD_REASON = "TERMINAL COUNT NOT AUTHORIZED";

// v9.4 Section 1 - LSC Verification Error Hold: fixed structural gate at
// T-10:00:00, independent of any discretionary hold the Launch Director
// may or may not have programmed for the Launch Status Check.
export const LSC_ERROR_HOLD_GATE_SECONDS = 600;
export const LSC_ERROR_HOLD_REASON = "LSC NOT VERIFIED BY T-10:00:00 — AWAITING LSC COMPLETION";

/**
 * T-COUNT (Revision Directive v3.0 Section 6.2.1): the procedure-driven,
 * hold-aware countdown to `lot`. While COUNTING it walks down in real time;
 * while HOLDING it is frozen at the mark where the active hold began.
 * `holdOffsetSeconds` accumulates the realized duration of every RELEASED
 * hold, which is what makes the count "drift" later exactly as a real
 * procedure-driven clock does when a hold runs long.
 *
 * Returns null if LOT has not been established (tCountStatus PENDING).
 */
export function computeTCountSeconds(mission: Mission, activeHold: MissionHold | null, now: Date = new Date()): number | null {
  if (!mission.lot || mission.tCountStatus === "PENDING") return null;
  if (mission.tCountStatus === "COMPLETE") return 0;

  if (mission.tCountStatus === "HOLDING" && activeHold?.actualStartedAt) {
    const frozenAt = (mission.lot.getTime() - activeHold.actualStartedAt.getTime()) / 1000;
    return frozenAt + mission.holdOffsetSeconds;
  }

  const raw = (mission.lot.getTime() - now.getTime()) / 1000;
  return raw + mission.holdOffsetSeconds;
}

/**
 * Launch Clock (formerly P-COUNT; Section 6.2.1, renamed/reworked by
 * Revision Directive v4.0 Section 7): confirmed LOT + realized duration of
 * every released hold + estimated duration of every scheduled (not yet
 * reached) or active *programmed* hold still within its estimate.
 * Non-freezing - recalculates on every read.
 *
 * An ACTIVE *unscheduled* hold has no pre-known duration (v4.0 Section
 * 7.5), so it cannot be folded in as a fixed estimate the way a programmed
 * hold is: instead its contribution is the real elapsed time since it
 * started, which grows continuously for as long as it remains active and
 * is superseded by its actualDurationSeconds the instant it is released.
 *
 * v5.0 Item 2 fix: a PROGRAMMED hold that has run into overage (elapsed
 * time has already exceeded its estimatedDurationSeconds, the HOLD
 * ELAPSED state from v4.1 Section 4) must behave the same way from that
 * point on - its estimate can no longer be trusted, so it switches to
 * real elapsed time exactly like an unscheduled hold. Previously this
 * function kept using the fixed estimate for a PROGRAMMED hold regardless
 * of overage, so the server's own projection never grew past the
 * estimate while the hold was still ACTIVE; the live growth the Launch
 * Clock displayed during overage was coming entirely from the frontend's
 * short-window (<=8s) interpolation layered on top of that stale, frozen
 * server value, which didn't match what actualDurationSeconds correctly
 * persisted the instant the hold was released - producing an apparent
 * "snap back" right at release rather than a seamless continuation.
 */
export function computeProjectedLiftoff(mission: Mission, holds: MissionHold[], now: Date = new Date()): Date | null {
  if (!mission.lot) return null;
  let offsetSeconds = 0;
  for (const hold of holds) {
    if (hold.status === "RELEASED") {
      offsetSeconds += hold.actualDurationSeconds ?? 0;
    } else if (hold.status === "SCHEDULED" || hold.status === "DURATION_ELAPSED") {
      offsetSeconds += hold.estimatedDurationSeconds ?? 0;
    } else if (hold.status === "ACTIVE" && hold.actualStartedAt) {
      const elapsedSeconds = (now.getTime() - hold.actualStartedAt.getTime()) / 1000;
      const inOverage = hold.estimatedDurationSeconds != null && elapsedSeconds >= hold.estimatedDurationSeconds;
      // v9.4 Section 1 - an ERROR hold (the LSC Verification Error Hold)
      // has no pre-known duration either, exactly like an UNSCHEDULED
      // hold - it must grow continuously in real elapsed time, not
      // contribute a flat zero offset the way a PROGRAMMED hold with no
      // estimate would.
      if (hold.type === "UNSCHEDULED" || hold.type === "ERROR" || inOverage) {
        offsetSeconds += elapsedSeconds;
      } else {
        offsetSeconds += hold.estimatedDurationSeconds ?? 0;
      }
    } else if (hold.status === "ACTIVE") {
      offsetSeconds += hold.estimatedDurationSeconds ?? 0;
    }
  }
  return new Date(mission.lot.getTime() + offsetSeconds * 1000);
}
