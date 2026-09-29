import fetch from "node-fetch";
import { env } from "../config/env";

// METOC Outlook (Revision Directive v8.0 Section 2, corrected/extended by
// v8.1) - real, live, keyless public data sources only, per Section 2.5's
// explicit no-fabrication requirement. Every tier below is sourced from a
// currently-accessible public API confirmed during this directive's build
// (this sandbox's network egress policy blocks outbound .gov domains
// entirely, so the actual live HTTP round-trip could not be executed from
// within this development session - each integration follows that source's
// current, documented, keyless contract, and fails closed with a clear
// per-tier error rather than fabricating data if the live call doesn't
// behave as documented once deployed somewhere with real .gov access).
//
// Tier (a)/(b) - api.weather.gov, the same NWS integration already used by
// weather.ts (Section 5.3 of the v2.0 directive), extended here to walk the
// full forecast/forecastHourly period arrays instead of just periods[0].
// Tier (c) - NOAA CPC's public ArcGIS vector REST services
// (mapservices.weather.noaa.gov/vector/rest/services/outlooks/...), a
// point-in-polygon query against the monthly temperature/precipitation
// outlook layers. Keyless.
// Tier (d) - NCEI's Access Data Service API v1
// (ncei.noaa.gov/access/services/data/v1), dataset normals-monthly-1991-2020,
// queried by a small bounding box around the site to find the nearest
// reporting station. Keyless.
// Reverse geocoding (v8.1 Section 1.2) - reuses the NWS /points response's
// own relativeLocation (city/state) and its linked county zone (county
// name) rather than adding a separate geocoding dependency.

const NWS_HEADERS = { "User-Agent": env.nwsUserAgent, Accept: "application/geo+json" };

async function nwsGet(url: string): Promise<any> {
  const res = await fetch(url, { headers: NWS_HEADERS });
  if (!res.ok) throw new Error(`NWS request failed (${res.status}): ${url}`);
  return res.json();
}

export interface LocationInfo {
  lat: number;
  lon: number;
  city?: string;
  county?: string;
  state?: string;
  gridId?: string;
  forecastUrl?: string;
  forecastHourlyUrl?: string;
  stationId?: string; // nearest METAR-style observation station, for the MEF "Station:" field
}

export async function resolveLocationInfo(lat: number, lon: number): Promise<LocationInfo> {
  const points = await nwsGet(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const props = points.properties ?? {};
  const info: LocationInfo = {
    lat,
    lon,
    city: props.relativeLocation?.properties?.city,
    state: props.relativeLocation?.properties?.state,
    gridId: props.gridId,
    forecastUrl: props.forecast,
    forecastHourlyUrl: props.forecastHourly,
  };
  if (props.county) {
    try {
      const zone = await nwsGet(props.county);
      info.county = zone.properties?.name;
    } catch {
      // County name is a nice-to-have; leave undefined rather than fail the whole lookup.
    }
  }
  if (props.observationStations) {
    try {
      const stations = await nwsGet(props.observationStations);
      info.stationId = stations.features?.[0]?.properties?.stationIdentifier;
    } catch {
      // Station ID is a nice-to-have for the MEF header; leave undefined on failure.
    }
  }
  return info;
}

export interface HourlyForecastPoint {
  startTime: string;
  temperatureF?: number;
  windSpeedText?: string;
  windDirectionDeg?: string;
  precipitationProbabilityPct?: number;
  shortForecast?: string;
}

export interface DailyForecastEntry {
  date: string; // YYYY-MM-DD
  label: string; // NWS period name, e.g. "Tuesday", "Tuesday Night"
  tempHighF?: number;
  tempLowF?: number;
  windSpeedText?: string;
  windDirectionDeg?: string;
  precipitationProbabilityPct?: number;
  shortForecast?: string;
  detailedForecast?: string;
}

/** Tier (a) - 3-Day Detailed Outlook: hourly resolution from forecastHourly, first 72 hours. */
export async function getThreeDayHourlyOutlook(forecastHourlyUrl: string): Promise<HourlyForecastPoint[]> {
  const data = await nwsGet(forecastHourlyUrl);
  const periods: any[] = data.properties?.periods ?? [];
  return periods.slice(0, 72).map((p) => ({
    startTime: p.startTime,
    temperatureF: p.temperature,
    windSpeedText: p.windSpeed,
    windDirectionDeg: p.windDirection,
    precipitationProbabilityPct: p.probabilityOfPrecipitation?.value ?? undefined,
    shortForecast: p.shortForecast,
  }));
}

/**
 * Tier (b) - 7-Day Detailed Outlook: the same NWS point-forecast product as
 * Tier (a), at daily resolution. The `forecast` endpoint returns 12-hour
 * day/night periods; this folds each calendar date's day+night pair into
 * one daily entry (day period supplies the high/short-forecast, night
 * period supplies the low) so it reads as one row per day, out to 7 days.
 */
export async function getSevenDayDailyOutlook(forecastUrl: string): Promise<DailyForecastEntry[]> {
  const data = await nwsGet(forecastUrl);
  const periods: any[] = data.properties?.periods ?? [];
  const byDate = new Map<string, DailyForecastEntry>();
  for (const p of periods) {
    const date = String(p.startTime).slice(0, 10);
    const existing: DailyForecastEntry = byDate.get(date) ?? { date, label: p.name };
    if (p.isDaytime) {
      existing.tempHighF = p.temperature;
      existing.windSpeedText = p.windSpeed;
      existing.windDirectionDeg = p.windDirection;
      existing.precipitationProbabilityPct = p.probabilityOfPrecipitation?.value ?? existing.precipitationProbabilityPct;
      existing.shortForecast = p.shortForecast;
      existing.detailedForecast = p.detailedForecast;
      existing.label = p.name;
    } else {
      existing.tempLowF = p.temperature;
      existing.precipitationProbabilityPct = existing.precipitationProbabilityPct ?? p.probabilityOfPrecipitation?.value ?? undefined;
      if (!existing.shortForecast) existing.shortForecast = p.shortForecast;
    }
    byDate.set(date, existing);
  }
  return Array.from(byDate.values()).slice(0, 7);
}

export interface HourlyDetail {
  dewpointF?: number;
  humidityPct?: number;
}

/**
 * The MEF's Dew/Humidity field is not carried by the daily forecast
 * product; forecastHourly does carry per-hour dewpoint/relativeHumidity.
 * Samples the hour closest to local midday (18Z, a reasonable proxy absent
 * a per-site UTC-offset lookup) for the given calendar date. Returns an
 * empty object (rendered as "-" on the MEF, never fabricated) if that hour
 * isn't present in the response.
 */
export async function getMiddayHourlyDetail(forecastHourlyUrl: string, date: string): Promise<HourlyDetail> {
  const data = await nwsGet(forecastHourlyUrl);
  const periods: any[] = data.properties?.periods ?? [];
  const dayPeriods = periods.filter((p) => String(p.startTime).slice(0, 10) === date);
  if (dayPeriods.length === 0) return {};
  const target = dayPeriods.reduce((best, p) => {
    const hour = new Date(p.startTime).getUTCHours();
    const bestHour = new Date(best.startTime).getUTCHours();
    return Math.abs(hour - 18) < Math.abs(bestHour - 18) ? p : best;
  });
  const dewpointC = target.dewpoint?.value;
  const humidityPct = target.relativeHumidity?.value;
  return {
    dewpointF: dewpointC != null ? (dewpointC * 9) / 5 + 32 : undefined,
    humidityPct: humidityPct != null ? Math.round(humidityPct) : undefined,
  };
}

/** Coarse coverage bucket derived from the NWS shortForecast text - real
 * data interpreted, not fabricated; NWS does not publish a clean coverage
 * enum in this product. */
export function deriveCoverageFromForecastText(text: string | undefined): string {
  if (!text) return "-";
  const t = text.toLowerCase();
  if (t.includes("overcast")) return "Overcast";
  if (t.includes("mostly cloudy")) return "Broken";
  if (t.includes("partly") || t.includes("scattered") || t.includes("mostly sunny") || t.includes("mostly clear")) return "Scattered";
  if (t.includes("sunny") || t.includes("clear") || t.includes("fair")) return "Clear";
  if (t.includes("cloudy")) return "Broken";
  return "Scattered";
}

export interface ClimateOutlookCategory {
  variable: "Temperature" | "Precipitation";
  category: string; // e.g. "Above Normal", "Near Normal", "Below Normal"
  probabilityPct?: number;
  periodLabel?: string;
  source: string;
}

const CPC_LAYERS: { variable: ClimateOutlookCategory["variable"]; url: string }[] = [
  { variable: "Temperature", url: "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_mthly_temp_outlk/MapServer/0/query" },
  { variable: "Precipitation", url: "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_mthly_precip_outlk/MapServer/0/query" },
];

/**
 * Tier (c) - ~30-Day Climate Outlook: NOAA CPC's monthly temperature and
 * precipitation outlook, a genuinely different (categorical/probabilistic)
 * product type per Section 2.3, not a deterministic point forecast. Queried
 * as a point-in-polygon lookup (the outlook is published as polygon zones,
 * standard ArcGIS REST query pattern) against the site's coordinates.
 */
export async function getMonthlyClimateOutlook(lat: number, lon: number): Promise<ClimateOutlookCategory[]> {
  const results: ClimateOutlookCategory[] = [];
  for (const layer of CPC_LAYERS) {
    const qs = new URLSearchParams({
      geometry: `${lon},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "*",
      returnGeometry: "false",
      f: "geojson",
    });
    const res = await fetch(`${layer.url}?${qs.toString()}`);
    if (!res.ok) throw new Error(`CPC ${layer.variable} outlook request failed (${res.status})`);
    const geojson = (await res.json()) as any;
    const feature = geojson.features?.[0];
    if (!feature) continue;
    const p = feature.properties ?? {};
    // CPC's published field names vary slightly by layer/season; check the
    // common variants rather than assuming one exact key.
    const category = p.Cat ?? p.CATEGORY ?? p.cat ?? p.Category ?? "UNAVAILABLE";
    const prob = p.Prob ?? p.PROB ?? p.prob ?? p.Probability;
    results.push({
      variable: layer.variable,
      category: String(category),
      probabilityPct: prob != null ? Number(prob) : undefined,
      periodLabel: p.Period ?? p.PERIOD ?? undefined,
      source: "NOAA Climate Prediction Center - Monthly Outlook",
    });
  }
  return results;
}

export interface MonthlyClimateNormal {
  month: number; // 1-12
  monthName: string;
  avgHighF?: number;
  avgLowF?: number;
  avgPrecipIn?: number;
  stationId?: string;
  stationName?: string;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Tier (d) - Month-by-Month Climatological Reference: NCEI's Access Data
 * Service API v1, dataset normals-monthly-1991-2020 (the current 30-year
 * normals period). Queried by a small bounding box around the site to find
 * the nearest reporting station's monthly normals, rather than requiring a
 * pre-known station ID (this app has no static station database).
 */
export async function getMonthlyClimateNormals(lat: number, lon: number): Promise<MonthlyClimateNormal[]> {
  const halfDeg = 0.5;
  const bbox = [lat + halfDeg, lon - halfDeg, lat - halfDeg, lon + halfDeg].join(",");
  const qs = new URLSearchParams({
    dataset: "normals-monthly-1991-2020",
    bbox,
    format: "json",
    units: "standard",
  });
  const res = await fetch(`https://www.ncei.noaa.gov/access/services/data/v1?${qs.toString()}`);
  if (!res.ok) throw new Error(`NCEI climate normals request failed (${res.status})`);
  const rows = (await res.json()) as any[];
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("NCEI climate normals returned no stations for this location");

  // Rows are one-per-station-per-date; pick the nearest station by its
  // reported LATITUDE/LONGITUDE, then keep only that station's 12 rows.
  const withDistance = rows
    .filter((r) => r.LATITUDE != null && r.LONGITUDE != null)
    .map((r) => ({ row: r, dist: Math.hypot(Number(r.LATITUDE) - lat, Number(r.LONGITUDE) - lon) }));
  if (withDistance.length === 0) throw new Error("NCEI climate normals rows missing station coordinates");
  const nearestStation = withDistance.sort((a, b) => a.dist - b.dist)[0].row.STATION;
  const stationRows = rows.filter((r) => r.STATION === nearestStation);

  const byMonth = new Map<number, MonthlyClimateNormal>();
  for (const r of stationRows) {
    const month = Number(String(r.DATE).slice(-2));
    if (!month || month < 1 || month > 12) continue;
    byMonth.set(month, {
      month,
      monthName: MONTH_NAMES[month - 1],
      avgHighF: r["MLY-TMAX-NORMAL"] != null ? Number(r["MLY-TMAX-NORMAL"]) : undefined,
      avgLowF: r["MLY-TMIN-NORMAL"] != null ? Number(r["MLY-TMIN-NORMAL"]) : undefined,
      avgPrecipIn: r["MLY-PRCP-NORMAL"] != null ? Number(r["MLY-PRCP-NORMAL"]) : undefined,
      stationId: nearestStation,
      stationName: r.NAME,
    });
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month - b.month);
}
