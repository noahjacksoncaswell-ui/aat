import { Mission, MissionHold } from "@prisma/client";

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
 * P-COUNT (Section 6.2.1): confirmed LOT + realized duration of every
 * released hold + estimated duration of every scheduled/active
 * (not-yet-released) hold. Non-freezing - recalculates on every read.
 */
export function computeProjectedLiftoff(mission: Mission, holds: MissionHold[]): Date | null {
  if (!mission.lot) return null;
  let offsetSeconds = 0;
  for (const hold of holds) {
    if (hold.status === "RELEASED") {
      offsetSeconds += hold.actualDurationSeconds ?? 0;
    } else if (hold.status === "SCHEDULED" || hold.status === "ACTIVE" || hold.status === "DURATION_ELAPSED") {
      offsetSeconds += hold.estimatedDurationSeconds ?? 0;
    }
  }
  return new Date(mission.lot.getTime() + offsetSeconds * 1000);
}
