import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMissions } from "../../api/resources";
import Chart from "../trajectory/Chart";
import LaunchPeriodCalendar from "./LaunchPeriodCalendar";
import type { MetocOutlookResponse } from "../../types";

// v8.0 Section 2 - the four outlook tiers, decreasing in granularity/
// certainty as the time horizon extends. Each tier is rendered
// independently of the others' fetch status (Section 2.5 - a tier that
// genuinely isn't accessible reports that clearly rather than being
// silently backfilled from another tier's data).

function povTone(pct: number): string {
  if (pct >= 60) return "text-aat-nogo border-aat-nogo";
  if (pct >= 25) return "text-aat-caution border-aat-caution";
  return "text-aat-go border-aat-go";
}

function TierUnavailable({ error }: { error: string }) {
  return <p className="text-sm text-aat-nogo">Unavailable — {error}</p>;
}

export default function WeatherOutlookTab({ outlook, loading }: { outlook: MetocOutlookResponse | undefined; loading: boolean }) {
  const { data: missions } = useQuery({ queryKey: ["missions", {}], queryFn: () => fetchMissions() });

  if (loading && !outlook) {
    return <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading weather outlook...</div>;
  }
  if (!outlook) return null;

  return (
    <div className="space-y-6">
      {/* Tier (a) - 3-Day Detailed Outlook */}
      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Tier A — 3-Day Detailed Outlook (Hourly Resolution)
        </div>
        {outlook.tierA.status === "UNAVAILABLE" ? (
          <TierUnavailable error={outlook.tierA.error} />
        ) : (
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <tr>
                  <th className="py-1 pr-3">Time</th>
                  <th className="py-1 pr-3">Temp (°F)</th>
                  <th className="py-1 pr-3">Wind</th>
                  <th className="py-1 pr-3">Precip %</th>
                  <th className="py-1 pr-3">Forecast</th>
                </tr>
              </thead>
              <tbody>
                {outlook.tierA.data.map((p) => (
                  <tr key={p.startTime} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-1 pr-3 font-mono">{new Date(p.startTime).toLocaleString("en-US", { weekday: "short", hour: "numeric" })}</td>
                    <td className="py-1 pr-3">{p.temperatureF ?? "—"}</td>
                    <td className="py-1 pr-3">
                      {p.windDirectionDeg ?? ""} {p.windSpeedText ?? "—"}
                    </td>
                    <td className="py-1 pr-3">{p.precipitationProbabilityPct ?? "—"}</td>
                    <td className="py-1 pr-3">{p.shortForecast ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tier (b) - 7-Day Detailed Outlook */}
      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Tier B — 7-Day Detailed Outlook (Daily Resolution)
        </div>
        {outlook.tierB.status === "UNAVAILABLE" ? (
          <TierUnavailable error={outlook.tierB.error} />
        ) : (
          <>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-1 pr-3">Day</th>
                  <th className="py-1 pr-3">High/Low</th>
                  <th className="py-1 pr-3">Wind</th>
                  <th className="py-1 pr-3">Precip %</th>
                  <th className="py-1 pr-3">Forecast</th>
                  <th className="py-1 pr-3">PoV</th>
                </tr>
              </thead>
              <tbody>
                {outlook.tierB.data.map((d) => (
                  <tr key={d.date} className="border-b border-slate-100 dark:border-slate-900">
                    <td className="py-1 pr-3 font-semibold">{d.label}</td>
                    <td className="py-1 pr-3">
                      {d.tempHighF ?? "—"}° / {d.tempLowF ?? "—"}°
                    </td>
                    <td className="py-1 pr-3">
                      {d.windDirectionDeg ?? ""} {d.windSpeedText ?? "—"}
                    </td>
                    <td className="py-1 pr-3">{d.precipitationProbabilityPct ?? "—"}</td>
                    <td className="py-1 pr-3">{d.shortForecast ?? "—"}</td>
                    <td className="py-1 pr-3">
                      <span className={`border px-1.5 py-0.5 font-bold ${povTone(d.pov.povPercent)}`}>{d.pov.povPercent}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">High Temp Trend (°F)</div>
                <Chart
                  data={outlook.tierB.data.map((d, i) => ({ x: i, y: d.tempHighF ?? 0 }))}
                  xLabel="Day"
                  yLabel="°F"
                  height={140}
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Precipitation Probability Trend (%)</div>
                <Chart
                  data={outlook.tierB.data.map((d, i) => ({ x: i, y: d.precipitationProbabilityPct ?? 0 }))}
                  xLabel="Day"
                  yLabel="%"
                  height={140}
                />
              </div>
            </div>
          </>
        )}
      </section>

      {/* Tier (c) - ~30-Day Climate Outlook */}
      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Tier C — ~30-Day Climate Outlook (NOAA CPC, Probabilistic)
        </div>
        <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
          A categorical/probabilistic trend, not a day-specific forecast — NOAA's Climate Prediction Center does not issue deterministic point forecasts at this range.
        </p>
        {outlook.tierC.status === "UNAVAILABLE" ? (
          <TierUnavailable error={outlook.tierC.error} />
        ) : outlook.tierC.data.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No outlook category returned for this location.</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            {outlook.tierC.data.map((c) => (
              <div key={c.variable} className="border border-slate-200 p-3 dark:border-slate-800">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{c.variable}</div>
                <div className="text-lg font-bold">{c.category}</div>
                {c.probabilityPct != null && <div className="text-xs text-slate-500 dark:text-slate-400">{c.probabilityPct}% probability</div>}
                <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-600">{c.source}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Tier (d) - Month-by-Month Climatological Reference */}
      <section className="card p-5">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Tier D — Month-by-Month Climatological Reference (30-Year Normals)
        </div>
        {outlook.tierD.status === "UNAVAILABLE" ? (
          <TierUnavailable error={outlook.tierD.error} />
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th className="py-1 pr-3">Month</th>
                <th className="py-1 pr-3">Avg High (°F)</th>
                <th className="py-1 pr-3">Avg Low (°F)</th>
                <th className="py-1 pr-3">Avg Precip (in)</th>
              </tr>
            </thead>
            <tbody>
              {outlook.tierD.data.map((m) => (
                <tr key={m.month} className="border-b border-slate-100 dark:border-slate-900">
                  <td className="py-1 pr-3">{m.monthName}</td>
                  <td className="py-1 pr-3">{m.avgHighF ?? "—"}</td>
                  <td className="py-1 pr-3">{m.avgLowF ?? "—"}</td>
                  <td className="py-1 pr-3">{m.avgPrecipIn ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {outlook.tierD.status === "OK" && outlook.tierD.data[0]?.stationName && (
          <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-600">
            Source station: {outlook.tierD.data[0].stationName} ({outlook.tierD.data[0].stationId})
          </p>
        )}
      </section>

      {/* Section 3 - Launch Period calendar + cross-reference */}
      <section>
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Launch Period Cross-Reference</div>
        <LaunchPeriodCalendar missions={missions} />
      </section>
    </div>
  );
}
