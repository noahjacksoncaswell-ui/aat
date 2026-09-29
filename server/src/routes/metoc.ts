import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import {
  resolveLocationInfo,
  getThreeDayHourlyOutlook,
  getSevenDayDailyOutlook,
  getMonthlyClimateOutlook,
  getMonthlyClimateNormals,
  getMiddayHourlyDetail,
  deriveCoverageFromForecastText,
  getForecastGridDetail,
} from "../services/metoc";
import { computeDayPov, computeMonthlyFavorability } from "../services/metocPov";
import { generateForecastDiscussion, toNarrativeDayInput, MetocNarrativeError } from "../services/metocNarrative";
import {
  findNearestStation,
  getMetars,
  getTafs,
  getPireps,
  getAirSigmets,
  getGAirmets,
  getCwas,
  getAreaForecastDiscussion,
  getMeteorologicalImpactStatement,
  getTcf,
  windtempRegionFor,
  getWindsTempsAloft,
  getActiveTfrs,
  getSpaceWeatherSummary,
} from "../services/aviationWeather";

// v8.0/v8.1 - METOC Outlook. Mounted at /api/metoc.

const router = Router();

type TierResult<T> = { status: "OK"; data: T } | { status: "UNAVAILABLE"; error: string };

async function safeTier<T>(fn: () => Promise<T>): Promise<TierResult<T>> {
  try {
    return { status: "OK", data: await fn() };
  } catch (err) {
    return { status: "UNAVAILABLE", error: err instanceof Error ? err.message : String(err) };
  }
}

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

interface ResolvedLocation {
  lat: number;
  lon: number;
  siteId?: string;
  siteName?: string;
  siteDesignator?: string;
}

async function resolveLocation(query: Record<string, unknown>): Promise<ResolvedLocation> {
  const siteId = typeof query.siteId === "string" && query.siteId ? query.siteId : undefined;
  if (siteId) {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw Object.assign(new Error("Site not found"), { httpStatus: 404 });
    return { lat: site.lat, lon: site.lon, siteId: site.id, siteName: site.name, siteDesignator: site.designator };
  }
  const lat = Number(query.lat);
  const lon = Number(query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw Object.assign(new Error("siteId, or both lat and lon, are required"), { httpStatus: 400 });
  }
  return { lat, lon };
}

router.get("/outlook", async (req, res) => {
  let loc: ResolvedLocation;
  try {
    loc = await resolveLocation(req.query);
  } catch (err: any) {
    return res.status(err.httpStatus ?? 400).json({ error: err.message });
  }

  let locationInfo;
  try {
    locationInfo = await resolveLocationInfo(loc.lat, loc.lon);
  } catch (err) {
    return res.status(502).json({ error: `Unable to resolve this location via the NWS point-forecast API: ${err instanceof Error ? err.message : String(err)}` });
  }

  const [tierARaw, tierBRaw, tierC, tierD, gridDetail] = await Promise.all([
    locationInfo.forecastHourlyUrl
      ? safeTier(() => getThreeDayHourlyOutlook(locationInfo.forecastHourlyUrl!))
      : Promise.resolve<TierResult<never>>({ status: "UNAVAILABLE", error: "No hourly forecast product for this location" }),
    locationInfo.forecastUrl
      ? safeTier(() => getSevenDayDailyOutlook(locationInfo.forecastUrl!))
      : Promise.resolve<TierResult<never>>({ status: "UNAVAILABLE", error: "No forecast product for this location" }),
    safeTier(() => getMonthlyClimateOutlook(loc.lat, loc.lon)),
    safeTier(() => getMonthlyClimateNormals(loc.lat, loc.lon)),
    // v8.2 Section 4 - wind gust + sky cover, same NWS gridpoint product,
    // best-effort: a failure here shouldn't take down Tiers a/b themselves,
    // it just means those two extra fields are absent.
    locationInfo.forecastGridDataUrl
      ? safeTier(() => getForecastGridDetail(locationInfo.forecastGridDataUrl!))
      : Promise.resolve<TierResult<never>>({ status: "UNAVAILABLE", error: "No gridpoint forecast product for this location" }),
  ]);

  let tierA: any = tierARaw;
  if (tierARaw.status === "OK" && gridDetail.status === "OK") {
    tierA = {
      status: "OK",
      data: tierARaw.data.map((p) => {
        const hourKey = p.startTime.slice(0, 13);
        const detail = gridDetail.data.hourly.get(hourKey);
        return { ...p, windGustMph: detail?.gustMph != null ? Math.round(detail.gustMph) : undefined, skyCoverPct: detail?.skyCoverPct };
      }),
    };
  }

  let tierB: any = tierBRaw;
  if (tierBRaw.status === "OK") {
    const daysWithPov = tierBRaw.data.map((day) => {
      const detail = gridDetail.status === "OK" ? gridDetail.data.byDate.get(day.date) : undefined;
      const enriched = {
        ...day,
        windGustMph: detail?.maxGustMph != null ? Math.round(detail.maxGustMph) : undefined,
        skyCoverPct: detail?.avgSkyCoverPct,
      };
      return { ...enriched, pov: computeDayPov(enriched) };
    });
    tierB = { status: "OK", data: daysWithPov };

    // v8.1 Section 3.1 - snapshot each in-window day's PoV on every load, so
    // the Trend & Window Analysis subtab can show how a date's risk has
    // moved over successive loads. Best-effort: never block the outlook
    // response on this write.
    prisma
      .$transaction(
        daysWithPov.map((d) =>
          prisma.metocPovSnapshot.create({
            data: {
              siteId: loc.siteId ?? null,
              lat: roundCoord(loc.lat),
              lon: roundCoord(loc.lon),
              forecastDate: new Date(`${d.date}T00:00:00.000Z`),
              povPercent: d.pov.povPercent,
              primaryConcerns: d.pov.primaryConcerns,
            },
          })
        )
      )
      .catch((err) => console.error("Failed to write METOC PoV snapshot batch", err));
  }

  const favorability = tierD.status === "OK" ? computeMonthlyFavorability(tierD.data) : null;

  res.json({
    location: {
      lat: loc.lat,
      lon: loc.lon,
      siteId: loc.siteId ?? null,
      siteName: loc.siteName ?? null,
      city: locationInfo.city ?? null,
      county: locationInfo.county ?? null,
      state: locationInfo.state ?? null,
    },
    tierA,
    tierB,
    tierC,
    tierD,
    favorability,
  });
});

router.get("/pov-trend", async (req, res) => {
  let loc: ResolvedLocation;
  try {
    loc = await resolveLocation(req.query);
  } catch (err: any) {
    return res.status(err.httpStatus ?? 400).json({ error: err.message });
  }
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  if (!date) return res.status(400).json({ error: "date (YYYY-MM-DD) is required" });

  const where = loc.siteId
    ? { siteId: loc.siteId, forecastDate: new Date(`${date}T00:00:00.000Z`) }
    : { siteId: null, lat: roundCoord(loc.lat), lon: roundCoord(loc.lon), forecastDate: new Date(`${date}T00:00:00.000Z`) };

  const rows = await prisma.metocPovSnapshot.findMany({ where, orderBy: { snapshotAt: "asc" } });
  res.json(rows.map((r) => ({ snapshotAt: r.snapshotAt, povPercent: r.povPercent, primaryConcerns: r.primaryConcerns })));
});

router.get("/favorability", async (req, res) => {
  let loc: ResolvedLocation;
  try {
    loc = await resolveLocation(req.query);
  } catch (err: any) {
    return res.status(err.httpStatus ?? 400).json({ error: err.message });
  }
  try {
    const normals = await getMonthlyClimateNormals(loc.lat, loc.lon);
    res.json(computeMonthlyFavorability(normals));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// v8.2 Section 5 - 24-Hour Aviation Brief. One aggregated response so the
// frontend tab is a single fetch; every product resolves independently via
// safeTier so one AWC product being down never takes the others with it
// (same fail-closed-per-product pattern as /outlook).
router.get("/aviation-brief", async (req, res) => {
  let loc: ResolvedLocation;
  try {
    loc = await resolveLocation(req.query);
  } catch (err: any) {
    return res.status(err.httpStatus ?? 400).json({ error: err.message });
  }

  let locationInfo;
  try {
    locationInfo = await resolveLocationInfo(loc.lat, loc.lon);
  } catch (err) {
    return res.status(502).json({ error: `Unable to resolve this location via the NWS point-forecast API: ${err instanceof Error ? err.message : String(err)}` });
  }

  const station = await safeTier(() => findNearestStation(loc.lat, loc.lon));
  const icaoId = station.status === "OK" ? station.data.icaoId : undefined;
  const region = windtempRegionFor(loc.lat, loc.lon);

  const [metars, tafs, pireps, sigmets, gairmets, cwas, tcf, windsAloft, tfrs, spaceWeather] = await Promise.all([
    icaoId
      ? safeTier(() => getMetars(icaoId))
      : Promise.resolve<TierResult<never>>({ status: "UNAVAILABLE", error: "No nearby AWC-reporting station" }),
    icaoId
      ? safeTier(() => getTafs(icaoId))
      : Promise.resolve<TierResult<never>>({ status: "UNAVAILABLE", error: "No nearby AWC-reporting station" }),
    icaoId
      ? safeTier(() => getPireps(icaoId))
      : Promise.resolve<TierResult<never>>({ status: "UNAVAILABLE", error: "No nearby AWC-reporting station" }),
    safeTier(() => getAirSigmets(loc.lat, loc.lon)),
    safeTier(() => getGAirmets(loc.lat, loc.lon)),
    safeTier(() => getCwas()),
    safeTier(() => getTcf()),
    safeTier(() => getWindsTempsAloft(region)),
    safeTier(() => getActiveTfrs(locationInfo!.state)),
    safeTier(() => getSpaceWeatherSummary()),
  ]);

  const afd = locationInfo.cwa
    ? await safeTier(() => getAreaForecastDiscussion(locationInfo!.cwa!))
    : ({ status: "UNAVAILABLE", error: "No CWA/WFO identifier resolved for this location" } as TierResult<never>);
  // v8.2 Section 5.2 - MIS has no reliable coordinate-based CWSU lookup this
  // build could confirm (ARTCC/CWSU boundaries differ from the NWS WFO/CWA
  // code already available) - returned as a national list rather than
  // guessing at a location filter that might silently be wrong.
  const mis = await safeTier(() => getMeteorologicalImpactStatement());

  res.json({
    station,
    metars,
    tafs,
    pireps,
    sigmets,
    gairmets,
    cwas,
    areaForecastDiscussion: afd,
    meteorologicalImpactStatement: mis,
    tcf,
    windsAloft: { ...windsAloft, region },
    tfrs,
    spaceWeather,
    // v8.2 Section 5.5 - complex/graphical-only products, opened externally
    // rather than force-reimplemented; deep-linked where the target site's
    // own param contract is confirmed (AWC's own metar/taf pages use the
    // same `ids` param the Data API documents), left general otherwise
    // rather than guessing at an unconfirmed query parameter.
    externalLinks: [
      { label: "SIGMET / G-AIRMET Graphical Viewer (AWC)", url: "https://aviationweather.gov/gairmet/" },
      { label: "TFM Convective Forecast, Graphical (AWC)", url: "https://aviationweather.gov/tcf/" },
      icaoId
        ? { label: `METAR/TAF Detail — ${icaoId} (AWC)`, url: `https://aviationweather.gov/data/metar/?ids=${icaoId}&std=1` }
        : { label: "METAR/TAF Data (AWC)", url: "https://aviationweather.gov/data/metar/" },
      { label: "NWS Graphical Forecast (graphical.weather.gov)", url: "https://graphical.weather.gov/" },
      { label: "Space Weather Dashboards (SWPC)", url: "https://www.swpc.noaa.gov/communities/aviation-community-dashboard" },
    ],
  });
});

// --- Unofficial MEF Generator (v8.0 Sections 4-6, v8.1 Section 4) ---

const mefBodySchema = z.object({
  siteId: z.string().optional(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  mode: z.enum(["range", "mission"]),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  missionId: z.string().optional(),
});

function dateRangeInclusive(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 24 * 3600 * 1000);
  }
  return dates;
}

function todayUtcDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

router.post("/mef/generate", async (req, res) => {
  const parsed = mefBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const body = parsed.data;

  let loc: ResolvedLocation;
  try {
    loc = await resolveLocation({ siteId: body.siteId, lat: body.lat, lon: body.lon });
  } catch (err: any) {
    return res.status(err.httpStatus ?? 400).json({ error: err.message });
  }

  // v8.1 Section 4.1 - Site: field reads N/A for manual coordinates.
  const siteFieldValue = loc.siteId ? `${loc.siteName} (${loc.siteDesignator})` : "N/A";

  const today = todayUtcDateStr();
  const horizonEnd = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  let days: string[];
  let missionLabel: string;

  if (body.mode === "range") {
    if (!body.startDate || !body.endDate) return res.status(400).json({ error: "startDate and endDate are required for mode=range" });
    days = dateRangeInclusive(body.startDate, body.endDate);
    if (days.length < 1 || days.length > 5) {
      return res.status(400).json({ error: "Date range must cover 1 to 5 consecutive days" });
    }
    if (days.some((d) => d < today || d > horizonEnd)) {
      return res.status(400).json({ error: "Every selected day must fall within the next 7 days (the detailed-forecast horizon)" });
    }
    missionLabel = "NONE/GENERAL MEF";
  } else {
    if (!body.missionId) return res.status(400).json({ error: "missionId is required for mode=mission" });
    const mission = await prisma.mission.findUnique({ where: { id: body.missionId }, include: { launchPeriodEntries: true } });
    if (!mission) return res.status(404).json({ error: "Mission not found" });
    if (mission.launchPeriodEntries.length === 0) return res.status(400).json({ error: "This mission has no Launch Period entries" });
    days = mission.launchPeriodEntries.map((e) => e.date.toISOString().slice(0, 10)).sort();
    if (days.some((d) => d < today || d > horizonEnd)) {
      return res.status(400).json({ error: "This mission's Launch Period is not fully within the next 7 days and cannot be selected for MEF generation" });
    }
    missionLabel = `${mission.designator} / ${mission.name}`;
  }

  let locationInfo;
  try {
    locationInfo = await resolveLocationInfo(loc.lat, loc.lon);
  } catch (err) {
    return res.status(502).json({ error: `Unable to resolve this location via the NWS point-forecast API: ${err instanceof Error ? err.message : String(err)}` });
  }
  if (!locationInfo.forecastUrl) return res.status(502).json({ error: "No NWS forecast product available for this location" });

  let dailyForecast;
  try {
    dailyForecast = await getSevenDayDailyOutlook(locationInfo.forecastUrl);
  } catch (err) {
    return res.status(502).json({ error: `NWS forecast request failed: ${err instanceof Error ? err.message : String(err)}` });
  }

  const selectedDays = dailyForecast.filter((d) => days.includes(d.date));
  if (selectedDays.length !== days.length) {
    return res.status(502).json({ error: "The NWS forecast product did not return data for every selected day" });
  }

  // v8.2 Section 6 - a real SWPC feed for the MEF's "Solar Activity" field
  // rather than the estimate it previously had to use. One current
  // snapshot applied to every day in range (SWPC's own short-range
  // products don't forecast day-by-day at this granularity either) -
  // best-effort, falls back to the honest "N/A - Not Sourced" on failure
  // rather than fabricating a bucket.
  const spaceWeather = await safeTier(() => getSpaceWeatherSummary());

  const perDay = await Promise.all(
    selectedDays.map(async (day) => {
      const pov = computeDayPov(day);
      let hourlyDetail: { dewpointF?: number; humidityPct?: number } = {};
      if (locationInfo!.forecastHourlyUrl) {
        try {
          hourlyDetail = await getMiddayHourlyDetail(locationInfo!.forecastHourlyUrl, day.date);
        } catch {
          // Dew/Humidity renders "-" on the document if unavailable; not fatal.
        }
      }
      return {
        date: day.date,
        label: day.label,
        tempHighF: day.tempHighF,
        tempLowF: day.tempLowF,
        tempAvgF: day.tempHighF != null && day.tempLowF != null ? Math.round(((day.tempHighF + day.tempLowF) / 2) * 10) / 10 : undefined,
        dewpointF: hourlyDetail.dewpointF,
        humidityPct: hourlyDetail.humidityPct,
        shortForecast: day.shortForecast,
        windSpeedText: day.windSpeedText,
        windDirectionDeg: day.windDirectionDeg,
        precipitationProbabilityPct: day.precipitationProbabilityPct,
        coverage: deriveCoverageFromForecastText(day.shortForecast),
        povPercent: pov.povPercent,
        primaryConcerns: pov.primaryConcerns,
        solarActivity: spaceWeather.status === "OK" ? spaceWeather.data.bucket : undefined,
      };
    })
  );

  const narrativeInputs = perDay.map((d) => toNarrativeDayInput(d as any, { date: d.date, povPercent: d.povPercent, primaryConcerns: d.primaryConcerns }));
  const siteLabel = loc.siteName ? `${loc.siteName} (${loc.siteDesignator})` : `${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}`;

  let forecastDiscussion: string;
  try {
    forecastDiscussion = await generateForecastDiscussion(narrativeInputs, siteLabel);
  } catch (err) {
    if (err instanceof MetocNarrativeError) return res.status(502).json({ error: err.message });
    return res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }

  res.json({
    header: {
      mission: missionLabel,
      issuedAt: new Date().toISOString(),
      valid: days,
      duration: body.mode === "mission" ? "Launch Period" : `${days.length}-Day Manual Selection`,
      site: siteFieldValue,
      station: locationInfo.stationId
        ? `${locationInfo.stationId} (${loc.lat.toFixed(2)}°N ${Math.abs(loc.lon).toFixed(2)}°W)`
        : `${loc.lat.toFixed(2)}°N ${Math.abs(loc.lon).toFixed(2)}°W`,
    },
    forecastDiscussion,
    days: perDay,
  });
});

export default router;
