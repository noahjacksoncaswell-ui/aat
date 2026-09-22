import fetch from "node-fetch";
import { env } from "../config/env";

export interface WeatherSnapshot {
  source: "NWS" | "OpenWeatherMap" | "UNAVAILABLE";
  stationId?: string;
  fetchedAt: string;
  temperatureC?: number;
  windSpeedKts?: number;
  windDirectionDeg?: number;
  windGustKts?: number;
  cloudCeilingFt?: number;
  visibilityMi?: number;
  barometricPressureHpa?: number;
  precipitationProbabilityPct?: number;
  shortForecast?: string;
  raw?: unknown;
}

// Simple in-memory cache; the frontend polls / manually refreshes every 5-10 min per spec.
const cache = new Map<string, { snapshot: WeatherSnapshot; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function mphToKts(mph: number) {
  return mph * 0.868976;
}

async function fetchFromNWS(lat: number, lon: number): Promise<WeatherSnapshot> {
  const pointsRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: { "User-Agent": env.nwsUserAgent, Accept: "application/geo+json" },
  });
  if (!pointsRes.ok) throw new Error(`NWS points lookup failed: ${pointsRes.status}`);
  const points = (await pointsRes.json()) as any;
  const stationsUrl = points.properties?.observationStations;
  const forecastUrl = points.properties?.forecastHourly;

  let latest: any = null;
  let stationId: string | undefined;
  if (stationsUrl) {
    const stationsRes = await fetch(stationsUrl, { headers: { "User-Agent": env.nwsUserAgent } });
    if (stationsRes.ok) {
      const stations = (await stationsRes.json()) as any;
      const firstStation = stations.features?.[0]?.id;
      stationId = stations.features?.[0]?.properties?.stationIdentifier ?? firstStation?.split("/").pop();
      if (firstStation) {
        const obsRes = await fetch(`${firstStation}/observations/latest`, {
          headers: { "User-Agent": env.nwsUserAgent },
        });
        if (obsRes.ok) latest = (await obsRes.json()) as any;
      }
    }
  }

  let shortForecast: string | undefined;
  let precipProb: number | undefined;
  if (forecastUrl) {
    const fRes = await fetch(forecastUrl, { headers: { "User-Agent": env.nwsUserAgent } });
    if (fRes.ok) {
      const f = (await fRes.json()) as any;
      const period = f.properties?.periods?.[0];
      shortForecast = period?.shortForecast;
      precipProb = period?.probabilityOfPrecipitation?.value ?? undefined;
    }
  }

  const props = latest?.properties;
  return {
    source: "NWS",
    stationId,
    fetchedAt: new Date().toISOString(),
    temperatureC: props?.temperature?.value ?? undefined,
    windSpeedKts: props?.windSpeed?.value != null ? props.windSpeed.value * 0.539957 : undefined, // km/h -> kts
    windDirectionDeg: props?.windDirection?.value ?? undefined,
    windGustKts: props?.windGust?.value != null ? props.windGust.value * 0.539957 : undefined,
    cloudCeilingFt: props?.cloudLayers?.[0]?.base?.value != null ? props.cloudLayers[0].base.value * 3.28084 : undefined,
    visibilityMi: props?.visibility?.value != null ? props.visibility.value / 1609.34 : undefined,
    barometricPressureHpa: props?.barometricPressure?.value != null ? props.barometricPressure.value / 100 : undefined,
    precipitationProbabilityPct: precipProb,
    shortForecast,
    raw: latest,
  };
}

async function fetchFromOpenWeatherMap(lat: number, lon: number): Promise<WeatherSnapshot> {
  if (!env.openWeatherMapApiKey) throw new Error("OpenWeatherMap API key not configured");
  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${env.openWeatherMapApiKey}`
  );
  if (!res.ok) throw new Error(`OpenWeatherMap request failed: ${res.status}`);
  const data = (await res.json()) as any;
  return {
    source: "OpenWeatherMap",
    fetchedAt: new Date().toISOString(),
    temperatureC: data.main?.temp,
    windSpeedKts: data.wind?.speed != null ? mphToKts(data.wind.speed * 2.23694) : undefined,
    windDirectionDeg: data.wind?.deg,
    windGustKts: data.wind?.gust != null ? mphToKts(data.wind.gust * 2.23694) : undefined,
    cloudCeilingFt: data.clouds?.all != null ? undefined : undefined,
    visibilityMi: data.visibility != null ? data.visibility / 1609.34 : undefined,
    barometricPressureHpa: data.main?.pressure,
    precipitationProbabilityPct: undefined,
    shortForecast: data.weather?.[0]?.description,
    raw: data,
  };
}

export async function getWeatherForSite(params: {
  siteId: string;
  lat: number;
  lon: number;
  countryCode: string;
  forceRefresh?: boolean;
}): Promise<WeatherSnapshot> {
  const cacheKey = params.siteId;
  const cached = cache.get(cacheKey);
  if (!params.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.snapshot;
  }

  let snapshot: WeatherSnapshot;
  try {
    if (params.countryCode === "US") {
      snapshot = await fetchFromNWS(params.lat, params.lon);
    } else if (env.openWeatherMapApiKey) {
      snapshot = await fetchFromOpenWeatherMap(params.lat, params.lon);
    } else {
      throw new Error("No weather provider available for non-US site");
    }
  } catch (err) {
    try {
      snapshot = await fetchFromOpenWeatherMap(params.lat, params.lon);
    } catch {
      snapshot = { source: "UNAVAILABLE", fetchedAt: new Date().toISOString() };
    }
  }

  cache.set(cacheKey, { snapshot, expiresAt: Date.now() + CACHE_TTL_MS });
  return snapshot;
}

export interface WeatherEvaluation {
  windExceeded: boolean;
  ceilingBelowMinimum: boolean;
  precipitationExceeded: boolean;
  overallStatus: "GO" | "CAUTION" | "NO_GO" | "UNKNOWN";
}

export function evaluateWeatherAgainstLimits(
  snapshot: WeatherSnapshot,
  limits: { windMaxKts?: number | null; ceilingMinFt?: number | null; maxPrecipProbability?: number | null }
): WeatherEvaluation {
  const windExceeded =
    limits.windMaxKts != null && snapshot.windSpeedKts != null ? snapshot.windSpeedKts > limits.windMaxKts : false;
  const ceilingBelowMinimum =
    limits.ceilingMinFt != null && snapshot.cloudCeilingFt != null
      ? snapshot.cloudCeilingFt < limits.ceilingMinFt
      : false;
  const precipitationExceeded =
    limits.maxPrecipProbability != null && snapshot.precipitationProbabilityPct != null
      ? snapshot.precipitationProbabilityPct > limits.maxPrecipProbability
      : false;

  let overallStatus: WeatherEvaluation["overallStatus"] = "GO";
  if (snapshot.source === "UNAVAILABLE") overallStatus = "UNKNOWN";
  else if (windExceeded || ceilingBelowMinimum || precipitationExceeded) overallStatus = "NO_GO";

  return { windExceeded, ceilingBelowMinimum, precipitationExceeded, overallStatus };
}
