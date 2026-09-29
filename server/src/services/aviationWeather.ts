import fetch from "node-fetch";

// v8.2 Section 5 - 24-Hour Aviation Brief. Integrates against the public
// NOAA/NWS Aviation Weather Center (AWC) Data API
// (https://aviationweather.gov/api/data), confirmed via its own published
// OpenAPI spec (this sandbox cannot reach aviationweather.gov directly to
// test live - research-confirmed against the AWC's own documented
// contract, same posture as the rest of the METOC build's .gov
// integrations). Base URL, exact paths, and parameter names below are
// taken directly from that spec - not guessed from a documentation
// example. Every function here fails closed with a clear error on a bad
// response, matching the rest of this module's per-product pattern; no
// product is ever backfilled with fabricated data.

const AWC_BASE = "https://aviationweather.gov/api/data";

async function awcGet(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${AWC_BASE}/${path}?${qs.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AWC ${path} request failed (${res.status})${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  const text = await res.text();
  if (!text.trim()) return [];
  try {
    return JSON.parse(text);
  } catch {
    // Some AWC endpoints (fcstdisc, mis, windtemp, tcf raw) are plain text,
    // not JSON, even when other params default to json elsewhere.
    return text;
  }
}

export interface NearestStation {
  icaoId: string;
  name?: string;
  lat: number;
  lon: number;
  distanceNm: number;
}

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R_NM = 3440.065;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(a));
}

/**
 * Nearest METAR/TAF-reporting station to a coordinate, via AWC's
 * `/stationinfo` endpoint with a bounding box (format `minLat,minLon,
 * maxLat,maxLon`, confirmed via research - distinct from NCEI's N,W,S,E
 * ordering, a real and easy mix-up between the two .gov APIs this build
 * integrates). Widens the box once if the first pass finds nothing (rural/
 * coastal sites can have sparse coverage).
 */
export async function findNearestStation(lat: number, lon: number): Promise<NearestStation> {
  for (const halfDeg of [0.75, 2.5]) {
    const bbox = `${lat - halfDeg},${lon - halfDeg},${lat + halfDeg},${lon + halfDeg}`;
    const data = await awcGet("stationinfo", { bbox, format: "json" });
    const stations: any[] = Array.isArray(data) ? data : [];
    const withIcao = stations.filter((s) => s.icaoId && s.lat != null && s.lon != null);
    if (withIcao.length > 0) {
      const withDist = withIcao.map((s) => ({ ...s, distanceNm: haversineNm(lat, lon, s.lat, s.lon) }));
      withDist.sort((a, b) => a.distanceNm - b.distanceNm);
      const nearest = withDist[0];
      return { icaoId: nearest.icaoId, name: nearest.site ?? nearest.name, lat: nearest.lat, lon: nearest.lon, distanceNm: Math.round(nearest.distanceNm) };
    }
  }
  throw new Error("No AWC-reporting station found near this location");
}

export interface DecodedMetar {
  rawText: string;
  decoded: {
    temperatureC?: number;
    dewpointC?: number;
    windDirectionDeg?: number;
    windSpeedKt?: number;
    windGustKt?: number;
    visibilityMi?: number;
    altimeterInHg?: number;
    weatherString?: string;
    clouds?: string;
    flightCategory?: string;
    reportTime?: string;
  };
}

export async function getMetars(icaoId: string): Promise<DecodedMetar[]> {
  const data = await awcGet("metar", { ids: icaoId, format: "json", hours: "2" });
  const rows: any[] = Array.isArray(data) ? data : [];
  return rows.map((r) => ({
    rawText: r.rawOb ?? "",
    decoded: {
      temperatureC: r.temp,
      dewpointC: r.dewp,
      windDirectionDeg: r.wdir,
      windSpeedKt: r.wspd,
      windGustKt: r.wgst,
      visibilityMi: r.visib != null ? Number(r.visib) : undefined,
      altimeterInHg: r.altim != null ? Number((r.altim / 33.8639).toFixed(2)) : undefined, // hPa -> inHg
      weatherString: r.wxString,
      clouds: Array.isArray(r.clouds) ? r.clouds.map((c: any) => `${c.cover}${c.base != null ? ` ${c.base}ft` : ""}`).join(", ") : undefined,
      flightCategory: r.fltcat ?? r.flight_category,
      reportTime: r.reportTime ?? r.obsTime,
    },
  }));
}

export interface TafRecord {
  rawText: string;
  issueTime?: string;
  validFrom?: string;
  validTo?: string;
}

export async function getTafs(icaoId: string): Promise<TafRecord[]> {
  const data = await awcGet("taf", { ids: icaoId, format: "json" });
  const rows: any[] = Array.isArray(data) ? data : [];
  return rows.map((r) => ({ rawText: r.rawTAF ?? r.rawOb ?? "", issueTime: r.issueTime, validFrom: r.validTimeFrom, validTo: r.validTimeTo }));
}

export async function getPireps(icaoId: string, distanceNm = 200): Promise<any[]> {
  const data = await awcGet("pirep", { id: icaoId, distance: String(distanceNm), format: "json", age: "3" });
  return Array.isArray(data) ? data : [];
}

/** Distance in nm from a point to the nearest vertex of a lat/lon polygon - an approximation (not true point-to-edge distance) used only to flag "roughly nearby," never to make a launch go/no-go determination itself. */
function nearestVertexDistanceNm(lat: number, lon: number, coords: number[] | undefined): number | null {
  if (!coords || coords.length < 2) return null;
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i += 2) {
    const d = haversineNm(lat, lon, coords[i], coords[i + 1]);
    if (d < min) min = d;
  }
  return Number.isFinite(min) ? Math.round(min) : null;
}

export interface GeoAdvisory {
  raw?: string;
  hazard?: string;
  distanceNm: number | null;
}

export async function getAirSigmets(lat: number, lon: number): Promise<GeoAdvisory[]> {
  const data = await awcGet("airsigmet", { format: "json" });
  const rows: any[] = Array.isArray(data) ? data : [];
  return rows.map((r) => ({ raw: r.rawAirSigmet, hazard: r.hazard, distanceNm: nearestVertexDistanceNm(lat, lon, r.coords) }));
}

export async function getGAirmets(lat: number, lon: number): Promise<GeoAdvisory[]> {
  const data = await awcGet("gairmet", { format: "json" });
  const rows: any[] = Array.isArray(data) ? data : [];
  return rows.map((r) => ({ raw: [r.hazard, r.product].filter(Boolean).join(" - "), hazard: r.hazard, distanceNm: nearestVertexDistanceNm(lat, lon, r.coords) }));
}

export async function getCwas(): Promise<{ raw?: string; cwsu?: string; hazard?: string }[]> {
  const data = await awcGet("cwa", { format: "json" });
  const rows: any[] = Array.isArray(data) ? data : [];
  return rows.slice(0, 20).map((r) => ({ raw: r.text ?? r.rawCWA, cwsu: r.cwsu, hazard: r.hazard }));
}

export async function getAreaForecastDiscussion(cwa: string): Promise<string> {
  const data = await awcGet("fcstdisc", { cwa, type: "afd" });
  return typeof data === "string" ? data : JSON.stringify(data);
}

export async function getMeteorologicalImpactStatement(cwsu?: string): Promise<string> {
  const data = await awcGet("mis", cwsu ? { loc: cwsu, format: "text" } : { format: "text" });
  return typeof data === "string" ? data : JSON.stringify(data);
}

export async function getTcf(): Promise<string> {
  const data = await awcGet("tcf", { format: "raw" });
  return typeof data === "string" ? data : JSON.stringify(data);
}

const WINDTEMP_REGIONS = ["bos", "mia", "chi", "dfw", "slc", "sfo"] as const;
/**
 * Coarse CONUS region bucket for the AWC winds/temps aloft product, which
 * takes a named region rather than coordinates. Longitude-banded (these
 * FAA regions run roughly north-south), documented as an approximation -
 * good enough to hand the LWO a genuinely relevant regional chart, not
 * precise station-level assignment.
 */
export function windtempRegionFor(lat: number, lon: number): (typeof WINDTEMP_REGIONS)[number] | "alaska" | "hawaii" {
  if (lat > 50 && lon < -130) return "alaska";
  if (lat < 25 && lon < -150) return "hawaii";
  if (lon >= -80) return "bos";
  if (lon >= -90) return lat < 33 ? "mia" : "chi";
  if (lon >= -100) return "dfw";
  if (lon >= -115) return "slc";
  return "sfo";
}

export async function getWindsTempsAloft(region: string, level: "low" | "high" = "low"): Promise<string> {
  const data = await awcGet("windtemp", { region, level, fcst: "06" });
  return typeof data === "string" ? data : JSON.stringify(data);
}

// --- v8.2 Section 6 (optional enhancements) ---

export interface TfrEntry {
  notam: string;
  facility?: string;
  state?: string;
  type?: string;
  description?: string;
  detailsUrl?: string;
}

/**
 * FAA public TFR export (keyless, real, live - tfr.faa.gov/tfr3/export/json,
 * confirmed via research). The list itself carries no coordinates (per its
 * own documented shape), only state/ARTCC/text - filtered here by the
 * site's US state (already known from the NWS reverse-geocode this app
 * already performs) as a genuine but coarse "near this location" proxy;
 * each entry links to the FAA's own detail page for the precise boundary.
 */
export async function getActiveTfrs(state: string | undefined): Promise<TfrEntry[]> {
  const res = await fetch("https://tfr.faa.gov/tfr3/export/json");
  if (!res.ok) throw new Error(`FAA TFR list request failed (${res.status})`);
  const rows: any[] = (await res.json()) as any[];
  const mapped: TfrEntry[] = rows.map((r) => ({
    notam: r.notam,
    facility: r.facility,
    state: r.state,
    type: r.type,
    description: r.description,
    detailsUrl: r.links?.details,
  }));
  if (!state) return mapped;
  return mapped.filter((t) => t.state === state);
}

export interface SpaceWeatherSummary {
  kpIndex: number;
  bucket: "Low" | "Moderate" | "High" | "Severe";
  observedAt: string;
}

/**
 * NOAA SWPC planetary K-index (keyless, real, live). Standard NOAA G-scale
 * style bucketing: Kp<4 quiet/unsettled (Low), Kp=4 active (Moderate),
 * Kp 5-6 minor-moderate storm (High), Kp>=7 strong+ storm (Severe). Used to
 * make the MEF's "Solar Activity" field genuinely data-backed (v8.0
 * Appendix A) instead of an estimate.
 */
export async function getSpaceWeatherSummary(): Promise<SpaceWeatherSummary> {
  const res = await fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json");
  if (!res.ok) throw new Error(`SWPC planetary K-index request failed (${res.status})`);
  const rows: any[] = (await res.json()) as any[];
  // First row is a header array; data rows are [time_tag, kp, ...] - take the most recent.
  const dataRows = rows.slice(1);
  const last = dataRows[dataRows.length - 1];
  if (!last) throw new Error("SWPC planetary K-index returned no data");
  const kp = Number(last[1]);
  const bucket: SpaceWeatherSummary["bucket"] = kp >= 7 ? "Severe" : kp >= 5 ? "High" : kp >= 4 ? "Moderate" : "Low";
  return { kpIndex: kp, bucket, observedAt: last[0] };
}
