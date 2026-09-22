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
          <TargetSubBox value="--" accent />
        </div>
        <div className="space-y-1">
          <ClockCell label="Launch Clock" sublabel="Projected liftoff" value="MISSION CANCELLED" accent />
          <TargetSubBox value="--" accent />
        </div>
      </div>
    );
  }

  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  const windowCountdown = targeted ? formatCountdown(targeted.windowOpen, now, { future: "W-", past: "W+" }) : null;
  const tMinus = tickTMinusSeconds(state, fetchedAt, now);

  const activeHold = state?.activeHold ?? null;
  const unscheduledHoldActive = activeHold?.status === "ACTIVE" && activeHold.type === "UNSCHEDULED";

  // Between 8s polls, interpolate the server's projectedLiftoff forward by
  // elapsed client time while an unscheduled hold is running so the target
  // sub-box visibly pushes back second by second (v4.0 Section 7.5), rather
  // than jumping only once per poll.
  const elapsedSinceFetchSeconds = (now.getTime() - fetchedAt.getTime()) / 1000;
  const projectedLiftoff =
    state?.projectedLiftoff && unscheduledHoldActive
      ? new Date(new Date(state.projectedLiftoff).getTime() + elapsedSinceFetchSeconds * 1000)
      : state?.projectedLiftoff
        ? new Date(state.projectedLiftoff)
        : null;

  const liftoffComplete = state?.tCountStatus === "COMPLETE" && !!state.liftoffActualTime;
  const launchCountdown = projectedLiftoff && !liftoffComplete ? formatCountdown(projectedLiftoff, now, { future: "L-", past: "L+" }) : null;

  let launchValue: string;
  if (!state?.lot) {
    launchValue = "PENDING (LOT NOT ESTABLISHED)";
  } else if (liftoffComplete) {
    launchValue = "LIFTOFF CONFIRMED";
  } else if (unscheduledHoldActive) {
    launchValue = "UNSCHEDULED HOLD";
  } else {
    launchValue = launchCountdown!.text;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <div className="space-y-1">
        <ClockCell
          label="Window Clock"
          sublabel="Launch opportunity window"
          value={targeted ? windowCountdown!.text : "PENDING (NO TARGETED LAUNCH OPPORTUNITY)"}
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
              ? "PENDING (LOT NOT ESTABLISHED)"
              : state.tCountStatus === "COMPLETE" && state.liftoffActualTime
                ? formatMet(state.liftoffActualTime, now)
                : formatTMinus(tMinus)
          }
          accent
          holding={state?.tCountStatus === "HOLDING"}
        />
        <TargetSubBox value={state?.lot ? formatTimestamp(state.lot, useZulu) : "--"} accent />
      </div>

      <div className="space-y-1">
        <ClockCell label="Launch Clock" sublabel="Projected liftoff" value={launchValue} accent holding={unscheduledHoldActive} />
        <TargetSubBox
          value={liftoffComplete ? formatTimestamp(state!.liftoffActualTime, useZulu) : projectedLiftoff ? formatTimestamp(projectedLiftoff, useZulu) : "--"}
          accent
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

function TargetSubBox({ value, accent }: { value: string; accent?: boolean }) {
  return (
    <div
      className={`flex h-6 items-center justify-center bg-aat-navy/60 px-2 text-[10px] font-mono text-slate-300 ${
        accent ? "border border-aat-caution/60" : "border border-transparent"
      }`}
    >
      {value}
    </div>
  );
}
