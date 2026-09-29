import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMetocFavorability, fetchMetocPovTrend } from "../../api/resources";
import type { MetocLocationParams } from "../../api/resources";
import { formatTimestamp } from "../../utils/time";
import { usePreferences } from "../../context/PreferencesContext";
import type { MetocOutlookResponse } from "../../types";

// v8.1 Section 3 - Trend & Window Analysis. "PoV" is used throughout per
// the reference MEF's own footnote (Appendix A, Note 1 of the v8.0
// directive), rather than repeatedly spelling out "Probability of
// Violation."

function favorabilityTone(pct: number): string {
  if (pct >= 70) return "bg-aat-go/20 text-aat-go border-aat-go";
  if (pct >= 40) return "bg-aat-caution/20 text-aat-caution border-aat-caution";
  return "bg-aat-nogo/20 text-aat-nogo border-aat-nogo";
}

export default function TrendWindowTab({ loc, outlook }: { loc: MetocLocationParams; outlook: MetocOutlookResponse | undefined }) {
  const { useZulu } = usePreferences();
  const tierBDays = outlook?.tierB.status === "OK" ? outlook.tierB.data : [];
  const [selectedDate, setSelectedDate] = useState<string>(tierBDays[0]?.date ?? "");

  const { data: trend } = useQuery({
    queryKey: ["metoc-pov-trend", loc, selectedDate],
    queryFn: () => fetchMetocPovTrend(loc, selectedDate),
    enabled: !!selectedDate,
  });

  const { data: favorability, error: favorabilityError } = useQuery({
    queryKey: ["metoc-favorability", loc],
    queryFn: () => fetchMetocFavorability(loc),
    retry: false,
  });

  return (
    <div className="space-y-6">
      {/* Section 3.1 - PoV Trend Log */}
      <section className="card p-5">
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">PoV Trend Log</div>
        <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
          A stored history of this date's computed PoV, one snapshot per page load, so a Launch Weather Officer can see how the risk
          assessment for an upcoming date has moved as the launch period approaches.
        </p>
        {tierBDays.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">The 7-day detailed outlook is unavailable for this location, so no dates are available to trend.</p>
        ) : (
          <>
            <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="input mb-3 w-auto">
              {tierBDays.map((d) => (
                <option key={d.date} value={d.date}>
                  {d.date} ({d.label})
                </option>
              ))}
            </select>
            {!trend || trend.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No snapshot history yet for this date — one is recorded each time this page loads.</p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="py-1 pr-3">Snapshot Time</th>
                    <th className="py-1 pr-3">PoV</th>
                    <th className="py-1 pr-3">Primary Concerns</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((t, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-900">
                      <td className="py-1 pr-3 font-mono">
                        {formatTimestamp(t.snapshotAt, useZulu)}
                        {i === trend.length - 1 ? " (current)" : ""}
                      </td>
                      <td className="py-1 pr-3 font-bold">{t.povPercent}%</td>
                      <td className="py-1 pr-3">{t.primaryConcerns.join(", ") || "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      {/* Section 3.2 - Launch Window Favorability Analysis */}
      <section className="card p-5">
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Launch Window Favorability Analysis</div>
        <p className="mb-3 text-[11px] text-slate-500 dark:text-slate-400">
          Derived from 30-year climate normals for this location — a reference for which months are historically favorable, not a
          per-day forecast. Complementary to the near-term PoV trend above, not a substitute for it.
        </p>
        {favorabilityError ? (
          <p className="text-sm text-aat-nogo">
            Unavailable — {(favorabilityError as any)?.response?.data?.error ?? "Failed to load climate normals for this location."}
          </p>
        ) : !favorability ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading climate normals...</p>
        ) : favorability.length === 0 ? (
          <p className="text-sm text-aat-nogo">No climate normals available for this location.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
            {favorability.map((m) => (
              <div key={m.month} className={`border p-2 text-center ${favorabilityTone(m.favorabilityPct)}`}>
                <div className="text-[10px] uppercase tracking-wide">{m.monthName.slice(0, 3)}</div>
                <div className="text-lg font-bold">{m.favorabilityPct}%</div>
                <div className="text-[9px] opacity-80">
                  {m.avgHighF ?? "—"}° / {m.avgLowF ?? "—"}°
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
