import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMetocOutlook, fetchSites } from "../api/resources";
import type { MetocLocationParams } from "../api/resources";
import AviationBriefTab from "../components/metoc/AviationBriefTab";
import WeatherOutlookTab from "../components/metoc/WeatherOutlookTab";
import TrendWindowTab from "../components/metoc/TrendWindowTab";
import MefGeneratorTab from "../components/metoc/MefGeneratorTab";

// AAT LOD Platform - Revision Directive v8.0/v8.1. METOC = Meteorological
// and Oceanographic, the standard U.S. military/range weather-operations
// term, consistent with this app's convention of real aerospace/range
// terminology.
//
// v8.1 Section 1 - a persistent, page-level location selector sits above
// all three subtabs and drives every tier of weather data shown anywhere on
// this page, in the same structural pattern as Mission Detail's persistent
// clock header sitting above its switchable subtabs (v4.0 Section 6). The
// selector is a genuine prerequisite: nothing below can render without a
// loaded location, so this page's data-fetching is owned entirely here and
// passed down as props - the three subtab components own no fetching of
// their own location context.

// v8.2 Section 5.1 - 24-Hour Aviation Brief positioned first, before
// Weather Outlook.
const SUBTABS = ["24-Hour Aviation Brief", "Weather Outlook", "Trend & Window Analysis", "MEF Products"] as const;
type Subtab = (typeof SUBTABS)[number];

export default function Metoc() {
  const [subtab, setSubtab] = useState<Subtab>("24-Hour Aviation Brief");
  const { data: sites } = useQuery({ queryKey: ["sites"], queryFn: () => fetchSites() });

  const [siteSelection, setSiteSelection] = useState<string>("");
  const [manualLat, setManualLat] = useState("");
  const [manualLon, setManualLon] = useState("");
  const [useManual, setUseManual] = useState(false);

  const [loadedLocation, setLoadedLocation] = useState<MetocLocationParams | null>(null);

  const {
    data: outlook,
    isFetching: outlookLoading,
    error: outlookError,
    refetch,
  } = useQuery({
    queryKey: ["metoc-outlook", loadedLocation],
    queryFn: () => fetchMetocOutlook(loadedLocation!),
    enabled: !!loadedLocation,
  });

  function handleLoad() {
    if (useManual) {
      const lat = Number(manualLat);
      const lon = Number(manualLon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      setLoadedLocation({ lat, lon });
    } else {
      if (!siteSelection) return;
      setLoadedLocation({ siteId: siteSelection });
    }
  }

  const selectedSite = sites?.find((s) => s.id === siteSelection);

  return (
    <div className="space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Meteorological Operations (METOC) Outlook</h1>
      </header>

      {/* v8.1 Section 1 - persistent location selector, above all subtabs. */}
      <section className="card space-y-3 p-5">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Location</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input type="radio" checked={!useManual} onChange={() => setUseManual(false)} />
            Registered Site
          </label>
          <select
            value={siteSelection}
            onChange={(e) => {
              setSiteSelection(e.target.value);
              setUseManual(false);
            }}
            disabled={useManual}
            className="input w-64"
          >
            <option value="">Select a site...</option>
            {(sites ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.designator} — {s.name}
              </option>
            ))}
          </select>

          <label className="ml-4 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input type="radio" checked={useManual} onChange={() => setUseManual(true)} />
            Manual Coordinates
          </label>
          <input
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            onFocus={() => setUseManual(true)}
            placeholder="Latitude"
            className="input w-28"
          />
          <input
            value={manualLon}
            onChange={(e) => setManualLon(e.target.value)}
            onFocus={() => setUseManual(true)}
            placeholder="Longitude"
            className="input w-28"
          />

          <button onClick={handleLoad} className="btn-primary">
            LOAD
          </button>
          {loadedLocation && (
            <button onClick={() => refetch()} disabled={outlookLoading} className="btn-secondary">
              {outlookLoading ? "Refreshing..." : "Refresh"}
            </button>
          )}
        </div>

        {/* v8.1 Section 1.2 - restated location info after LOAD. */}
        {outlookError && (
          <p className="text-sm text-aat-nogo">
            {(outlookError as any)?.response?.data?.error ?? "Failed to load location - the NWS point-forecast API did not resolve this location."}
          </p>
        )}
        {outlook && (
          <div className="border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
            <span className="font-mono">
              {outlook.location.lat.toFixed(4)}, {outlook.location.lon.toFixed(4)}
            </span>
            {outlook.location.siteName && <span> — {outlook.location.siteName}</span>}
            {(outlook.location.city || outlook.location.county || outlook.location.state) && (
              <span className="text-slate-500 dark:text-slate-400">
                {" "}
                — {[outlook.location.city, outlook.location.county ? `${outlook.location.county} County` : null, outlook.location.state]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
        {SUBTABS.map((t) => (
          <button
            key={t}
            onClick={() => setSubtab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              subtab === t
                ? "border-aat-accent text-aat-accent"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {!loadedLocation ? (
        <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Select a location above and press LOAD to bring up its weather outlook.
        </div>
      ) : (
        <>
          {subtab === "24-Hour Aviation Brief" && <AviationBriefTab loc={loadedLocation} />}
          {subtab === "Weather Outlook" && <WeatherOutlookTab outlook={outlook} loading={outlookLoading} />}
          {subtab === "Trend & Window Analysis" && <TrendWindowTab loc={loadedLocation} outlook={outlook} />}
          {subtab === "MEF Products" && (
            <MefGeneratorTab
              loc={loadedLocation}
              // Derived from the actual selection (loadedLocation/selectedSite), not
              // from the outlook response - that response can fail to load (e.g. the
              // upstream NWS API being unreachable) independently of which location
              // was actually selected, and this line must never misreport a selected
              // registered site as "MANUAL COORDINATES" just because that fetch failed.
              locationLabel={loadedLocation.siteId ? selectedSite?.name ?? "" : "MANUAL COORDINATES"}
              coordsLabel={
                outlook
                  ? `${outlook.location.lat.toFixed(4)}, ${outlook.location.lon.toFixed(4)}`
                  : loadedLocation.siteId && selectedSite
                  ? `${selectedSite.lat.toFixed(4)}, ${selectedSite.lon.toFixed(4)}`
                  : loadedLocation.lat != null && loadedLocation.lon != null
                  ? `${loadedLocation.lat.toFixed(4)}, ${loadedLocation.lon.toFixed(4)}`
                  : ""
              }
            />
          )}
        </>
      )}
    </div>
  );
}
