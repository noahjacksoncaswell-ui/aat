import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCountdownState } from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatTimestamp, formatCountdown } from "../utils/time";
import { formatMet, formatTMinus, tickTMinusSeconds } from "../utils/countdownMath";
import type { Mission } from "../types";

/**
 * Revision Directive v3.0 Section 6, renamed and reworked by Revision
 * Directive v4.0 Section 7 - all three mission clocks render in a
 * persistent strip at the top of the mission detail page, live-updating
 * regardless of which subtab is active. Six boxes total: a main
 * countdown/status box for each of Window Clock (W-), Test Clock (T-), and
 * Launch Clock (L-), each paired with a smaller sub-box showing the exact
 * absolute date/time the clock above it is counting toward.
 *
 * Letter reassignment per v4.0 Section 7.1 is NOT 1:1 with the prior
 * naming: former L-COUNT -> Window Clock (W-), former P-COUNT -> Launch
 * Clock (L-). Former T-COUNT stays Test Clock (T-). Each countdown
 * formatter below embeds its own correct letter prefix directly in the
 * returned text (W-/W+, T-/T+, L-/L+) - this is what fixes the prior
 * defect where the Test and Launch boxes both rendered a "T-" prefix.
 */
export default function PersistentClockHeader({ mission }: { mission: Mission }) {
  const { useZulu } = usePreferences();
  const [now, setNow] = useState(new Date());
  const [fetchedAt, setFetchedAt] = useState(new Date());
  const cancelled = mission.status === "CANCELLED";

  const { data: state } = useQuery({
    queryKey: ["countdown", mission.id],
    queryFn: () => fetchCountdownState(mission.id),
    refetchInterval: 8000,
    enabled: !cancelled,
  });

  useEffect(() => {
    if (state) setFetchedAt(new Date());
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (cancelled) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <ClockCell label="Window Clock" sublabel="Launch opportunity window" value="MISSION CANCELLED" />
          <TargetSubBox value="--" />
        </div>
        <div className="space-y-1">
          <ClockCell label="Test Clock" sublabel="Targeted Lift-Off Time (LOT)" value="MISSION CANCELLED" accent />
          <TargetSubBox value="--" />
        </div>
        <div className="space-y-1">
          <ClockCell label="Launch Clock" sublabel="Projected liftoff" value="MISSION CANCELLED" accent />
          <TargetSubBox value="--" />
        </div>
      </div>
    );
  }

  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  const windowCountdown = targeted ? formatCountdown(targeted.windowOpen, now, { future: "W-", past: "W+" }) : null;
  const tMinus = tickTMinusSeconds(state, fetchedAt, now);

  const activeHold = state?.activeHold ?? null;
  const unscheduledHoldActive = activeHold?.status === "ACTIVE" && activeHold.type === "UNSCHEDULED";
  // v4.1 Item 4 - a PROGRAMMED hold whose estimated duration has elapsed
  // without being released is in overage: its estimate can no longer be
  // trusted, so from this point on the Launch Clock treats it exactly like
  // an active unscheduled hold (continuous live push-back), just with its
  // own distinct status text.
  const programmedHoldOverage =
    activeHold?.status === "ACTIVE" &&
    activeHold.type === "PROGRAMMED" &&
    !!activeHold.actualStartedAt &&
    activeHold.estimatedDurationSeconds != null &&
    (now.getTime() - new Date(activeHold.actualStartedAt).getTime()) / 1000 >= activeHold.estimatedDurationSeconds;
  const openEndedHold = unscheduledHoldActive || programmedHoldOverage;

  // Between 8s polls, interpolate the server's projectedLiftoff forward by
  // elapsed client time while an unscheduled hold or a programmed-hold
  // overage is running, so the target sub-box visibly pushes back second by
  // second (v4.0 Section 7.5, v4.1 Section 4), rather than jumping only
  // once per poll.
  const elapsedSinceFetchSeconds = (now.getTime() - fetchedAt.getTime()) / 1000;
  const projectedLiftoff =
    state?.projectedLiftoff && openEndedHold
      ? new Date(new Date(state.projectedLiftoff).getTime() + elapsedSinceFetchSeconds * 1000)
      : state?.projectedLiftoff
        ? new Date(state.projectedLiftoff)
        : null;

  const liftoffComplete = state?.tCountStatus === "COMPLETE" && !!state.liftoffActualTime;
  const launchCountdown = projectedLiftoff && !liftoffComplete ? formatCountdown(projectedLiftoff, now, { future: "L-", past: "L+" }) : null;

  let launchValue: string;
  if (!state?.lot) {
    launchValue = "PENDING (NO LOT SET)";
  } else if (liftoffComplete) {
    launchValue = "LIFTOFF CONFIRMED";
  } else if (unscheduledHoldActive) {
    launchValue = "UNSCHEDULED HOLD";
  } else if (programmedHoldOverage) {
    launchValue = "HOLD ELAPSED";
  } else {
    launchValue = launchCountdown!.text;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div className="space-y-1">
        <ClockCell
          label="Window Clock"
          sublabel="Launch opportunity window"
          value={targeted ? windowCountdown!.text : "PENDING (NO TLO SEL)"}
        />
        <TargetSubBox value={targeted ? formatTimestamp(targeted.windowOpen, useZulu) : "--"} />
      </div>

      <div className="space-y-1">
        <ClockCell
          label="Test Clock"
          sublabel={
            state?.tCountStatus === "COMPLETE" && state.liftoffActualTime
              ? "MET (Mission Elapsed Time)"
              : `STATUS: ${state?.tCountStatus ?? "PENDING"}`
          }
          value={
            !state || state.tCountStatus === "PENDING"
              ? "PENDING (NO LOT SET)"
              : state.tCountStatus === "COMPLETE" && state.liftoffActualTime
                ? formatMet(state.liftoffActualTime, now)
                : formatTMinus(tMinus)
          }
          accent
          holding={state?.tCountStatus === "HOLDING"}
        />
        <TargetSubBox value={state?.lot ? formatTimestamp(state.lot, useZulu) : "--"} />
      </div>

      <div className="space-y-1">
        <ClockCell label="Launch Clock" sublabel="Projected liftoff" value={launchValue} accent holding={openEndedHold} />
        <TargetSubBox
          value={liftoffComplete ? formatTimestamp(state!.liftoffActualTime, useZulu) : projectedLiftoff ? formatTimestamp(projectedLiftoff, useZulu) : "--"}
        />
      </div>
    </div>
  );
}

function ClockCell({ label, sublabel, value, accent, holding }: { label: string; sublabel: string; value: string; accent?: boolean; holding?: boolean }) {
  return (
    <div className={`card flex flex-col items-center justify-center bg-aat-navy px-4 py-3 text-white ${accent ? "border-aat-caution" : ""}`}>
      <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
      <div className={`font-mono text-xl font-bold tabular-nums ${holding ? "text-aat-caution" : ""}`}>{value}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-500">{sublabel}</div>
    </div>
  );
}

// v4.1 Item 3 - all three target-date sub-boxes always use this same
// light-gray-outline, dark-gray-interior styling (matching the Window
// Clock main box), never the orange/yellow accent - that is reserved for
// exactly the Test Clock and Launch Clock main boxes above, and only those.
function TargetSubBox({ value }: { value: string }) {
  return (
    <div className="flex h-7 items-center justify-center border border-zinc-800 bg-zinc-900 px-2 text-[14px] font-mono text-slate-300">{value}</div>
  );
}
