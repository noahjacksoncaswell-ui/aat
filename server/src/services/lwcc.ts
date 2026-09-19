// LWCC - Launch Weather Commit Criteria (Revision Directive v3.0 Section 7)
//
// Requirement numbers, descriptions, and limit text below are extracted
// (numeric thresholds and structural pattern only) from APC-STD-23-01 for
// the purpose of implementing the specific go/no-go limits this module
// evaluates. This is not a reproduction of the standard.
//
// Live data sources in this build (NOAA/NWS current conditions + a rolling
// WeatherSample trend buffer) cannot directly observe every parameter the
// standard defines - lightning presence/range, cloud coverage/vertical
// extent/transparency, trajectory-relative geometry, and upper-level wind
// shear have no live feed in this environment. Those requirements are
// MANUAL: a station reports the observed condition, and that report (not a
// sensor) drives the row's state until superseded. Requirements backed by a
// live station-weather parameter are LIVE and re-evaluated on every read.

export type LwccEvaluationMode = "LIVE" | "MANUAL";
export type LwccRiskLevel = "NONE" | "LOW" | "MODERATE" | "HIGH" | "ACTIVE" | "MANUAL" | "INSUFFICIENT_DATA";
export type LwccRowStatus = "NO_VIOLATION" | "VIOLATION" | "HOLD_ACTIVE" | "OVERRIDDEN" | "NOT_REPORTED";

export interface LwccRequirementDef {
  no: number;
  description: string;
  limitText: string;
  mode: LwccEvaluationMode;
  /** Seconds a hold persists after the triggering condition, for timed-hold requirements. */
  holdDurationSeconds?: number;
  /** For LIVE rows: which live parameter this evaluates and its comparator. */
  liveParam?: "windSpeedKts" | "windGustKts" | "temperatureC" | "visibilityMi" | "precipitationProbabilityPct";
  compare?: "GT" | "LT";
  threshold?: number;
}

export const LWCC_REQUIREMENTS: LwccRequirementDef[] = [
  {
    no: 3,
    description: "Lightning proximity (site/trajectory)",
    limitText: "Wait 30 min after lightning ≤10 nmi slant distance from launch site or flight trajectory",
    mode: "MANUAL",
    holdDurationSeconds: 30 * 60,
  },
  {
    no: 4,
    description: "Lightning from nearby thunderstorm",
    limitText:
      "Wait 30 min after lightning within/from a thunderstorm if trajectory passes ≤10 nmi of any part of that storm",
    mode: "MANUAL",
    holdDurationSeconds: 30 * 60,
  },
  {
    no: 5,
    description: "Cloud in flight trajectory",
    limitText:
      "No launch if trajectory passes through a cloud/layer >500 ft vertical extent within 1 nmi of site, any cloud ≤5,000 ft AGL within 2 nmi of site, or a cloud producing precipitation at any altitude",
    mode: "MANUAL",
  },
  {
    no: 6,
    description: "Cloud coverage/vertical extent",
    limitText:
      "No launch through >50% cloud coverage at any altitude, nor a layer with >500 ft vertical extent (base to top across layers) where coverage is <50%",
    mode: "MANUAL",
  },
  {
    no: 7,
    description: "Direct cloud penetration",
    limitText: "No launch into or through any cloud",
    mode: "MANUAL",
  },
  {
    no: 8,
    description: "Sustained surface wind",
    limitText: "No launch if sustained surface wind exceeds 17 kt (20 mph)",
    mode: "LIVE",
    liveParam: "windSpeedKts",
    compare: "GT",
    threshold: 17,
  },
  {
    no: 9,
    description: "Wind gusts / shear (surface)",
    limitText: "Wait 15 min if gusts exceed 30 kt (34.5 mph) or moderate+ wind shear present at site",
    mode: "LIVE",
    liveParam: "windGustKts",
    compare: "GT",
    threshold: 30,
    holdDurationSeconds: 15 * 60,
  },
  {
    no: 10,
    description: "Upper-level wind shear",
    limitText:
      "No launch through conditions ≥2,000 ft AGL with wind shear that could cause flight control issues or considerable trajectory deviation",
    mode: "MANUAL",
  },
  {
    no: 11,
    description: "Precipitation proximity (site)",
    limitText: "No launch if precipitation present within 5 nmi of launch site",
    mode: "LIVE",
    liveParam: "precipitationProbabilityPct",
    compare: "GT",
    threshold: 60,
  },
  {
    no: 12,
    description: "Precipitation proximity (trajectory)",
    limitText:
      "No launch if trajectory passes ≤3 nmi of precipitation/producing cloud, unless site precipitation is below moderate AND the non-transparent cloud is >1.5 nmi slant distance from trajectory",
    mode: "MANUAL",
  },
  {
    no: 13,
    description: "Moderate+ precipitation",
    limitText: "Wait 15 min after moderate or greater precipitation within 10 nmi of site or trajectory",
    mode: "LIVE",
    liveParam: "precipitationProbabilityPct",
    compare: "GT",
    threshold: 80,
    holdDurationSeconds: 15 * 60,
  },
  {
    no: 14,
    description: "24-hr average temperature",
    limitText: "No launch if 24-hr daily average temp at site is <15°F or >110°F",
    mode: "LIVE",
    liveParam: "temperatureC",
  },
  {
    no: 15,
    description: "Low surface temperature",
    limitText:
      "No launch if temp <20°F, unless temp has been >20°F for ≥30 consecutive minutes AND chief engineer confirms all electrical/flight/recovery/avionics systems nominal",
    mode: "LIVE",
    liveParam: "temperatureC",
    compare: "LT",
    threshold: -6.7, // 20 F
  },
  {
    no: 16,
    description: "Sustained cold aloft",
    limitText:
      "No launch if trajectory carries the vehicle into sustained temps <−15°F for ≥3 min during ascent/descent prior to full recovery deployment",
    mode: "MANUAL",
  },
  {
    no: 17,
    description: "Cold non-transparent cloud",
    limitText: "No launch if trajectory passes through/within 1 nmi of a non-transparent cloud ≤32°F with >500 ft vertical extent",
    mode: "MANUAL",
  },
  {
    no: 18,
    description: "Horizontal visibility",
    limitText: "No launch if horizontal visibility at any altitude (including site) is <5 nmi",
    mode: "LIVE",
    liveParam: "visibilityMi",
    compare: "LT",
    threshold: 5.75, // 5 nmi in statute miles
  },
  {
    no: 19,
    description: "Obscuration coverage",
    limitText: "No launch through any altitude with >50% (five-tenths) cloud/obscuring-phenomena coverage",
    mode: "MANUAL",
  },
  {
    no: 20,
    description: "Thunderstorm proximity",
    limitText: "No launch within 20 nmi of the edge of a lightning-producing thunderstorm until 30 min after last observed lightning",
    mode: "MANUAL",
    holdDurationSeconds: 30 * 60,
  },
  {
    no: 21,
    description: "Other storm proximity",
    limitText: "No launch within 20 nmi of edge of any other storm if site temp ≤32°F AND storm precipitation is moderate or greater",
    mode: "MANUAL",
  },
  {
    no: 22,
    description: "Severe surface wind system",
    limitText:
      "Wait 3 hrs after detection of a storm/system with sustained winds >40 kt (46 mph), or >20 kt (23 mph) if <32°F, within 50 nmi of site",
    mode: "LIVE",
    liveParam: "windSpeedKts",
    compare: "GT",
    threshold: 40,
    holdDurationSeconds: 3 * 60 * 60,
  },
];

export function getRequirement(no: number): LwccRequirementDef {
  const req = LWCC_REQUIREMENTS.find((r) => r.no === no);
  if (!req) throw new Error(`Unknown LWCC requirement number: ${no}`);
  return req;
}

function evaluateLiveThreshold(req: LwccRequirementDef, value: number | undefined | null): boolean {
  if (value == null || req.compare == null || req.threshold == null) return false;
  return req.compare === "GT" ? value > req.threshold : value < req.threshold;
}

export function getLiveValue(
  req: LwccRequirementDef,
  snapshot: { windSpeedKts?: number; windGustKts?: number; temperatureC?: number; visibilityMi?: number; precipitationProbabilityPct?: number }
): number | undefined {
  if (!req.liveParam) return undefined;
  return snapshot[req.liveParam];
}

export function evaluateLiveViolation(
  req: LwccRequirementDef,
  snapshot: { windSpeedKts?: number; windGustKts?: number; temperatureC?: number; visibilityMi?: number; precipitationProbabilityPct?: number }
): boolean {
  if (req.no === 14) {
    // 24-hr average uses caller-supplied rolling average rather than instantaneous temp.
    return false;
  }
  return evaluateLiveThreshold(req, getLiveValue(req, snapshot));
}

export interface TrendRisk {
  risk15: LwccRiskLevel;
  risk30: LwccRiskLevel;
}

/**
 * Lightweight dashboard snapshot: evaluates only the LIVE-mapped
 * instantaneous/held requirements against current weather. Manual-report
 * rows and their hold state are intentionally excluded here - the full
 * picture (including manual reports, active holds, and overrides) lives on
 * the mission's LWCC tab per Section 7; this is just the top-line badge.
 */
export function quickLiveComplianceCheck(snapshot: {
  windSpeedKts?: number;
  windGustKts?: number;
  temperatureC?: number;
  visibilityMi?: number;
  precipitationProbabilityPct?: number;
}): { status: "NO_VIOLATION" | "VIOLATION" | "UNKNOWN"; violating: LwccRequirementDef[] } {
  if (Object.values(snapshot).every((v) => v == null)) return { status: "UNKNOWN", violating: [] };
  const violating = LWCC_REQUIREMENTS.filter((r) => r.mode === "LIVE" && r.no !== 14 && evaluateLiveViolation(r, snapshot));
  return { status: violating.length > 0 ? "VIOLATION" : "NO_VIOLATION", violating };
}

/** Simple linear-extrapolation risk heuristic from a rolling sample buffer - not a forecast model. */
export function computeTrendRisk(req: LwccRequirementDef, currentValue: number | undefined, valueAt15MinAgo: number | undefined): TrendRisk {
  if (req.mode !== "LIVE" || currentValue == null) return { risk15: "MANUAL", risk30: "MANUAL" };
  if (valueAt15MinAgo == null || req.threshold == null || req.compare == null) {
    return { risk15: "INSUFFICIENT_DATA", risk30: "INSUFFICIENT_DATA" };
  }
  const slopePerMin = (currentValue - valueAt15MinAgo) / 15;
  const approaching = req.compare === "GT" ? slopePerMin > 0 : slopePerMin < 0;
  if (!approaching) return { risk15: "LOW", risk30: "LOW" };

  const distance = Math.abs(req.threshold - currentValue);
  const minutesToThreshold = slopePerMin !== 0 ? distance / Math.abs(slopePerMin) : Infinity;

  const tier = (minutes: number): LwccRiskLevel => {
    if (minutes <= 15) return "HIGH";
    if (minutes <= 30) return "MODERATE";
    return "LOW";
  };
  return { risk15: tier(minutesToThreshold), risk30: tier(minutesToThreshold) };
}
