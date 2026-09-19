import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCountdownState } from "../api/resources";
import { usePreferences } from "../context/PreferencesContext";
import { formatTimestamp, formatCountdown } from "../utils/time";
import { formatMet, formatTMinus, tickTMinusSeconds } from "../utils/countdownMath";
import type { Mission } from "../types";

/**
 * Revision Directive v3.0 Section 6 - all three mission clocks render in a
 * persistent strip at the top of the mission detail page, live-updating
 * regardless of which subtab is active, so personnel referencing Log/LWCC/
 * Polls during an active countdown retain time-critical situational
 * awareness without switching tabs.
 */
export default function PersistentClockHeader({ mission }: { mission: Mission }) {
  const { useZulu } = usePreferences();
  const [now, setNow] = useState(new Date());
  const [fetchedAt, setFetchedAt] = useState(new Date());

  const { data: state } = useQuery({
    queryKey: ["countdown", mission.id],
    queryFn: () => fetchCountdownState(mission.id),
    refetchInterval: 8000,
  });

  useEffect(() => {
    if (state) setFetchedAt(new Date());
  }, [state]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const targeted = mission.launchPeriodEntries.find((e) => e.isTargeted);
  const lCount = targeted ? formatCountdown(targeted.windowOpen, now) : null;
  const tMinus = tickTMinusSeconds(state, fetchedAt, now);

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <ClockCell
        label="L-COUNT"
        sublabel="Launch opportunity window"
        value={targeted ? lCount!.text : "PENDING (NO TARGETED LAUNCH OPPORTUNITY)"}
      />
      <ClockCell
        label="T-COUNT"
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
        accent={state?.tCountStatus === "HOLDING"}
      />
      <ClockCell
        label="P-COUNT"
        sublabel="Projected liftoff"
        value={state?.projectedLiftoff ? formatTimestamp(state.projectedLiftoff, useZulu) : "PENDING (LOT NOT ESTABLISHED)"}
      />
    </div>
  );
}

function ClockCell({ label, sublabel, value, accent }: { label: string; sublabel: string; value: string; accent?: boolean }) {
  return (
    <div className={`card flex flex-col items-center justify-center bg-aat-navy px-4 py-3 text-white ${accent ? "border-aat-caution" : ""}`}>
      <div className="text-[10px] uppercase tracking-widest text-slate-400">{label}</div>
      <div className={`font-mono text-xl font-bold tabular-nums ${accent ? "text-aat-caution" : ""}`}>{value}</div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-500">{sublabel}</div>
    </div>
  );
}
