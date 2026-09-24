import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCountdownState } from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatTimestamp, formatCountdown } from "../utils/time";
import { formatMetParts, formatTMinus, tickTMinusSeconds } from "../utils/countdownMath";
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
export default function PersistentClockHeader({
  mission,
  large,
  abbreviated,
}: {
  mission: Mission;
  large?: boolean;
  /** v5.4 (Abbreviated Status Text directive) - Range Ops Display only. Shortens
   * pending/hold status strings so they don't force the clock boxes to
   * resize on that page's large-format layout. Every other caller of this
   * component omits it and keeps the current full-length wording. */
  abbreviated?: boolean;
}) {
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
      <div className={`grid grid-cols-1 gap-2 sm:grid-cols-3 ${large ? "sm:gap-4" : ""}`}>
        <div className="space-y-1">
          <ClockCell label="Window Clock" sublabel="Launch opportunity window" value="MISSION CANCELLED" large={large} />
          <TargetSubBox value="--" large={large} />
        </div>
        <div className="space-y-1">
          <ClockCell label="Test Clock" sublabel="Targeted Lift-Off Time (LOT)" value="MISSION CANCELLED" accent large={large} />
          <TargetSubBox value="--" large={large} />
        </div>
        <div className="space-y-1">
          <ClockCell label="Launch Clock" sublabel="Projected liftoff" value="MISSION CANCELLED" accent large={large} />
          <TargetSubBox value="--" large={large} />
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
    launchValue = abbreviated ? "PENDING" : "PENDING (NO LOT SET)";
  } else if (liftoffComplete) {
    // v7.1 Section 1 - Range Ops Display only, same abbreviated-text
    // convention as the other abbreviated states below.
    launchValue = abbreviated ? "LIFTOFF CONF." : "LIFTOFF CONFIRMED";
  } else if (unscheduledHoldActive) {
    launchValue = abbreviated ? "UNSCH. HOLD" : "UNSCHEDULED HOLD";
  } else if (programmedHoldOverage) {
    launchValue = abbreviated ? "HOLD ELAP." : "HOLD ELAPSED";
  } else {
    launchValue = launchCountdown!.text;
  }

  return (
    <div className={`grid grid-cols-1 gap-2 sm:grid-cols-3 ${large ? "sm:gap-4" : ""}`}>
      <div className="space-y-1">
        <ClockCell
          label="Window Clock"
          sublabel="Launch opportunity window"
          // v6.1 Item 13 - once the targeted window has opened, the Window
          // Clock displays OPEN rather than continuing to count up (W+...);
          // it does not track elapsed time past that point. This is
          // specific to the Window Clock - the Test and Launch clocks'
          // own post-target count-up behavior (T+/L+) is untouched.
          value={targeted ? (windowCountdown!.isPast ? "OPEN" : windowCountdown!.text) : abbreviated ? "PENDING" : "PENDING (NO TLO SEL)"}
          large={large}
        />
        <TargetSubBox value={targeted ? formatTimestamp(targeted.windowOpen, useZulu) : "--"} large={large} />
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
              ? abbreviated
                ? "PENDING"
                : "PENDING (NO LOT SET)"
              : state.tCountStatus === "COMPLETE" && state.liftoffActualTime
                ? (() => {
                    const met = formatMetParts(state.liftoffActualTime, now);
                    // v7.1 Section 2 - Range Ops Display only: the "MET"
                    // label renders at roughly half the size of the
                    // elapsed-time value beside it. Elsewhere (Mission
                    // Detail), both render at the cell's normal size.
                    return large ? (
                      <>
                        <span className="text-[0.5em] align-middle">{met.prefix} </span>
                        {met.core}
                      </>
                    ) : (
                      `${met.prefix} ${met.core}`
                    );
                  })()
                : formatTMinus(tMinus)
          }
          accent
          holding={state?.tCountStatus === "HOLDING"}
          large={large}
        />
        <TargetSubBox value={state?.lot ? formatTimestamp(state.lot, useZulu) : "--"} large={large} />
      </div>

      <div className="space-y-1">
        <ClockCell label="Launch Clock" sublabel="Projected liftoff" value={launchValue} accent holding={openEndedHold} large={large} />
        <TargetSubBox
          value={liftoffComplete ? formatTimestamp(state!.liftoffActualTime, useZulu) : projectedLiftoff ? formatTimestamp(projectedLiftoff, useZulu) : "--"}
          large={large}
        />
      </div>
    </div>
  );
}

function ClockCell({
  label,
  sublabel,
  value,
  accent,
  holding,
  large,
}: {
  label: string;
  sublabel: string;
  value: React.ReactNode;
  accent?: boolean;
  holding?: boolean;
  large?: boolean;
}) {
  return (
    <div
      className={`card flex flex-col items-center justify-center bg-aat-navy text-white ${accent ? "border-aat-caution" : ""} ${large ? "px-6 py-8" : "px-4 py-3"}`}
    >
      <div className={`uppercase tracking-widest text-slate-400 ${large ? "text-base" : "text-[10px]"}`}>{label}</div>
      <div className={`font-mono font-bold tabular-nums ${holding ? "text-aat-caution" : ""} ${large ? "text-6xl" : "text-xl"}`}>{value}</div>
      <div className={`uppercase tracking-wide text-slate-500 ${large ? "mt-2 text-sm" : "mt-0.5 text-[9px]"}`}>{sublabel}</div>
    </div>
  );
}

// v4.1 Item 3 - all three target-date sub-boxes always use this same
// light-gray-outline, dark-gray-interior styling (matching the Window
// Clock main box), never the orange/yellow accent - that is reserved for
// exactly the Test Clock and Launch Clock main boxes above, and only those.
function TargetSubBox({ value, large }: { value: string; large?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center border border-zinc-800 bg-zinc-900 font-mono text-slate-300 ${large ? "h-14 px-2 text-3xl" : "h-7 px-2 text-[14px]"}`}
    >
      {value}
    </div>
  );
}
