import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMetocAviationBrief } from "../../api/resources";
import type { MetocLocationParams } from "../../api/resources";

// v8.2 Section 5 - 24-Hour Aviation Brief. Day-of-launch reference for the
// LWO, used alongside the mission-specific LWCC table. Uses whatever
// AWC/SWPC/FAA product is available at whatever lead time it actually
// covers - a product that only reaches 6 or 12 hours is shown as-is rather
// than omitted for not reaching a full 24.

function TierBlock<T>({
  tier,
  render,
}: {
  tier: { status: "OK"; data: T } | { status: "UNAVAILABLE"; error: string };
  render: (data: T) => React.ReactNode;
}) {
  if (tier.status === "UNAVAILABLE") return <p className="text-sm text-aat-nogo">Unavailable — {tier.error}</p>;
  return <>{render(tier.data)}</>;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{children}</div>;
}

function RawTextBlock({ text }: { text: string }) {
  return <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap border border-slate-200 p-2 font-mono text-[11px] dark:border-slate-800">{text || "No data returned."}</pre>;
}

export default function AviationBriefTab({ loc }: { loc: MetocLocationParams }) {
  const { data: brief, isLoading, error } = useQuery({
    queryKey: ["metoc-aviation-brief", loc],
    queryFn: () => fetchMetocAviationBrief(loc),
    retry: false,
  });

  if (isLoading) return <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">Loading aviation brief...</div>;
  if (error || !brief) {
    return (
      <div className="card p-8 text-center text-sm text-aat-nogo">
        {(error as any)?.response?.data?.error ?? "Failed to load the 24-Hour Aviation Brief for this location."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <SectionHeader>Nearest Reporting Station</SectionHeader>
        <TierBlock
          tier={brief.station}
          render={(s) => (
            <div className="text-sm">
              <span className="font-mono font-bold">{s.icaoId}</span>
              {s.name ? ` — ${s.name}` : ""} — {s.distanceNm} nm from selected location
            </div>
          )}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <SectionHeader>METAR</SectionHeader>
          <TierBlock
            tier={brief.metars}
            render={(rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No recent METAR for this station.</p>
              ) : (
                <div className="space-y-3">
                  {rows.map((m, i) => (
                    <div key={i} className="border border-slate-200 p-2 dark:border-slate-800">
                      <div className="mb-1.5 font-mono text-[11px]">{m.rawText}</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-3">
                        <div>Temp: {m.decoded.temperatureC ?? "—"}°C</div>
                        <div>Dewpoint: {m.decoded.dewpointC ?? "—"}°C</div>
                        <div>
                          Wind: {m.decoded.windDirectionDeg ?? "—"}° @ {m.decoded.windSpeedKt ?? "—"}kt{m.decoded.windGustKt ? ` G${m.decoded.windGustKt}kt` : ""}
                        </div>
                        <div>Visibility: {m.decoded.visibilityMi ?? "—"} mi</div>
                        <div>Altimeter: {m.decoded.altimeterInHg ?? "—"} inHg</div>
                        <div>Category: {m.decoded.flightCategory ?? "—"}</div>
                        <div className="col-span-2 sm:col-span-3">Sky: {m.decoded.clouds ?? "—"}</div>
                        {m.decoded.weatherString && <div className="col-span-2 sm:col-span-3">Weather: {m.decoded.weatherString}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          />
        </section>

        <section className="card p-5">
          <SectionHeader>TAF</SectionHeader>
          <TierBlock
            tier={brief.tafs}
            render={(rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No current TAF for this station.</p>
              ) : (
                <div className="space-y-2">
                  {rows.map((t, i) => (
                    <RawTextBlock key={i} text={t.rawText} />
                  ))}
                </div>
              )
            }
          />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <SectionHeader>PIREPs (Pilot Reports)</SectionHeader>
          <TierBlock
            tier={brief.pireps}
            render={(rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No PIREPs within range.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-[11px] font-mono">
                  {rows.map((p: any, i: number) => (
                    <li key={i} className="border-b border-slate-100 pb-1 dark:border-slate-900">
                      {p.rawOb ?? JSON.stringify(p)}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </section>

        <section className="card p-5">
          <SectionHeader>SIGMETs / G-AIRMETs</SectionHeader>
          <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-600">
            DISTANCE IS NEAREST-VERTEX, NOT PRECISE BOUNDARY.
          </p>
          <TierBlock
            tier={brief.sigmets}
            render={(rows) => (
              <div className="mb-3">
                <div className="mb-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">SIGMET / AIRMET</div>
                {rows.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">None active.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {rows.map((r, i) => (
                      <li key={i} className={r.distanceNm != null && r.distanceNm < 150 ? "text-aat-caution" : ""}>
                        {r.hazard ?? "—"} {r.distanceNm != null ? `— ${r.distanceNm} nm` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          />
          <TierBlock
            tier={brief.gairmets}
            render={(rows) => (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">G-AIRMET</div>
                {rows.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">None active.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {rows.map((r, i) => (
                      <li key={i} className={r.distanceNm != null && r.distanceNm < 150 ? "text-aat-caution" : ""}>
                        {r.raw ?? r.hazard ?? "—"} {r.distanceNm != null ? `— ${r.distanceNm} nm` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          />
        </section>
      </div>

      <section className="card p-5">
        <SectionHeader>Area Forecast Discussion</SectionHeader>
        <TierBlock tier={brief.areaForecastDiscussion} render={(text) => <RawTextBlock text={text} />} />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <SectionHeader>Center Weather Advisories (National)</SectionHeader>
          <TierBlock
            tier={brief.cwas}
            render={(rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">None active.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto text-[11px] font-mono">
                  {rows.map((c, i) => (
                    <li key={i} className="border-b border-slate-100 pb-1 dark:border-slate-900">
                      [{c.cwsu ?? "—"}] {c.raw ?? c.hazard ?? "—"}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </section>
        <section className="card p-5">
          <SectionHeader>Meteorological Impact Statement (National)</SectionHeader>
          <TierBlock tier={brief.meteorologicalImpactStatement} render={(text) => <RawTextBlock text={text} />} />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <SectionHeader>TFM Convective Forecast</SectionHeader>
          <TierBlock tier={brief.tcf} render={(text) => <RawTextBlock text={text} />} />
        </section>
        <section className="card p-5">
          <SectionHeader>
            Winds / Temperatures Aloft{brief.windsAloft.region ? ` — Region: ${brief.windsAloft.region.toUpperCase()}` : ""}
          </SectionHeader>
          <TierBlock tier={brief.windsAloft} render={(text) => <RawTextBlock text={text} />} />
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <SectionHeader>Active TFRs (By State)</SectionHeader>
          <TierBlock
            tier={brief.tfrs}
            render={(rows) =>
              rows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No active TFRs on file for this state.</p>
              ) : (
                <ul className="max-h-48 space-y-1.5 overflow-y-auto text-xs">
                  {rows.map((t, i) => (
                    <li key={i} className="border-b border-slate-100 pb-1.5 dark:border-slate-900">
                      <span className="font-mono font-bold">{t.notam}</span> [{t.type ?? "—"}] {t.description ?? ""}
                      {t.detailsUrl && (
                        <a href={t.detailsUrl} target="_blank" rel="noreferrer" className="ml-2 text-aat-accent hover:underline">
                          Details ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </section>
        <section className="card p-5">
          <SectionHeader>Space Weather (SWPC Planetary K-Index)</SectionHeader>
          <TierBlock
            tier={brief.spaceWeather}
            render={(sw) => (
              <div className="text-sm">
                Kp {sw.kpIndex} — <span className="font-bold">{sw.bucket}</span>
                <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-600">Observed {sw.observedAt}</div>
              </div>
            )}
          />
        </section>
      </div>

      <section className="card p-5">
        <SectionHeader>External References</SectionHeader>
        <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-600">
          COMPLEX GRAPHICAL PRODUCTS — OPENS SOURCE SITE IN A NEW TAB.
        </p>
        <div className="flex flex-wrap gap-2">
          {brief.externalLinks.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
              {l.label} ↗
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
