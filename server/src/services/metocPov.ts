// v8.0 Section 6 - "Probability of Violation and Primary Concerns - Computed,
// Not Invented." Reuses the same LWCC_REQUIREMENTS threshold definitions the
// live LWCC engine (lwcc.ts) evaluates against current conditions - this
// module applies those same thresholds to forecast data instead. It is
// deliberately NOT a second, separate weather-threshold evaluation system:
// every threshold value below is read directly from LWCC_REQUIREMENTS.
//
// Scope limitation, stated plainly rather than papered over: the NWS daily
// point-forecast product (Tiers a/b) does not carry every parameter the full
// LWCC engine evaluates. It has no forecast lightning, cloud geometry,
// upper-level shear, or visibility figures - those requirements are MANUAL
// in the live engine (a human report, not a sensor) and have no forecast
// analog either, so they are excluded here, not fabricated. What the
// forecast product DOES carry - temperature, wind, precipitation
// probability - covers every LIVE-mode requirement's `liveParam` mapping,
// so this module evaluates exactly that subset: LWCCR 8, 9, 11, 13, 14 (the
// average-temperature counterpart to 15, evaluated here against the
// forecast high/low midpoint rather than a live rolling average), 15, 22.
//
// PoV methodology (Section 6 explicitly asks for a documented, reviewable
// approach, not a "certified calculation"):
//   1. For each LWCCR requirement in scope, compute a 0-1 "severity" score:
//      how far the forecast value sits past (1.0) or short of (0.0) the
//      requirement's threshold, ramped over a fixed buffer window rather
//      than a hard boolean - a forecast landing just inside the limit is
//      still flagged as a lesser concern, matching how a real LWO would
//      read a forecast that's "close."
//   2. For the two requirements keyed off precipitation probability (11,
//      13), the NWS forecast's own probabilityOfPrecipitation figure IS a
//      stated confidence value for that variable - severity uses it
//      directly, which is the "forecast data source's own stated
//      confidence" half of Section 6(b). Temperature and wind have no
//      analogous per-value confidence figure in this product, so those
//      severities are threshold-proximity only (Section 6(a)) - a real
//      limitation of the underlying data, not a shortcut taken here.
//   3. Per-day PoV = 1 - the product of (1 - severity) across every
//      in-scope requirement (a standard "probability at least one fails"
//      combinator, treating each requirement's risk as independent - a
//      simplification, not a joint statistical model), clamped to
//      [5, 95] so the figure is never presented as either impossible or
//      certain from a forecast alone.
//   4. Primary Concerns lists every requirement whose severity exceeds a
//      reporting threshold (0.15), so a day with no meaningful risk shows
//      no concerns rather than the full requirement list at near-zero risk.

import { LWCC_REQUIREMENTS, getRequirement } from "./lwcc";
import type { DailyForecastEntry } from "./metoc";

interface ScopedRule {
  no: number;
  label: string; // matches this app's own LWCCR naming convention, not Appendix A's differently-numbered standard
  severity: (day: DailyForecastEntry) => number | undefined; // undefined = insufficient data for this day
}

function ramp(value: number, thresholdStart: number, thresholdFull: number): number {
  // thresholdStart = value at which concern begins (severity 0); thresholdFull
  // = value at which the requirement is fully violated (severity 1). Handles
  // both "higher is worse" (thresholdFull > thresholdStart) and "lower is
  // worse" (thresholdFull < thresholdStart) automatically.
  if (thresholdFull === thresholdStart) return value >= thresholdFull ? 1 : 0;
  const t = (value - thresholdStart) / (thresholdFull - thresholdStart);
  return Math.max(0, Math.min(1, t));
}

function parseWindKts(windSpeedText: string | undefined): number | undefined {
  if (!windSpeedText) return undefined;
  // NWS windSpeed is a free-text field, e.g. "10 mph" or "10 to 15 mph".
  // Take the higher end of a range as the conservative forecast estimate.
  const matches = windSpeedText.match(/(\d+)/g);
  if (!matches || matches.length === 0) return undefined;
  const maxMph = Math.max(...matches.map(Number));
  return maxMph * 0.868976;
}

const cToF = (c: number) => (c * 9) / 5 + 32;

const SCOPED_RULES: ScopedRule[] = [
  {
    no: 8,
    label: "Sustained Surface Wind Rule",
    severity: (day) => {
      const kts = parseWindKts(day.windSpeedText);
      if (kts == null) return undefined;
      const threshold = getRequirement(8).threshold!; // 17 kt
      return ramp(kts, threshold - 5, threshold + 5);
    },
  },
  {
    no: 9,
    // v8.2 Section 4 - the NWS gridpoint forecast's own windGust field is
    // now surfaced (metoc.ts getForecastGridDetail); prefer it when present
    // instead of the sustained-speed proxy this previously had to use.
    label: "Wind Gust / Shear Rule",
    severity: (day) => {
      const kts = day.windGustMph != null ? day.windGustMph * 0.868976 : parseWindKts(day.windSpeedText);
      if (kts == null) return undefined;
      const threshold = getRequirement(9).threshold!; // 30 kt
      return ramp(kts, threshold - 8, threshold + 4);
    },
  },
  {
    no: 11,
    label: "Precipitation Proximity Rule",
    severity: (day) => {
      if (day.precipitationProbabilityPct == null) return undefined;
      const threshold = getRequirement(11).threshold!; // 60%
      return ramp(day.precipitationProbabilityPct, threshold - 25, threshold + 10);
    },
  },
  {
    no: 13,
    label: "Precipitation Flight Rule",
    severity: (day) => {
      if (day.precipitationProbabilityPct == null) return undefined;
      const threshold = getRequirement(13).threshold!; // 80%
      return ramp(day.precipitationProbabilityPct, threshold - 20, threshold + 10);
    },
  },
  {
    no: 14,
    label: "Average Temperature Rule",
    severity: (day) => {
      if (day.tempHighF == null || day.tempLowF == null) return undefined;
      const avgF = (day.tempHighF + day.tempLowF) / 2;
      // LWCCR 14's live rule is a boolean band (<15F or >110F); ramp a 10F
      // buffer on each side rather than treating it as a hard cutoff.
      const lowSeverity = ramp(avgF, 25, 15);
      const highSeverity = ramp(avgF, 100, 110);
      return Math.max(lowSeverity, highSeverity);
    },
  },
  {
    no: 15,
    label: "Low Surface Temperature Rule",
    severity: (day) => {
      if (day.tempLowF == null) return undefined;
      const thresholdF = cToF(getRequirement(15).threshold!); // 20F
      return ramp(day.tempLowF, thresholdF + 5, thresholdF - 5);
    },
  },
  {
    no: 22,
    label: "Severe Surface Wind System Rule",
    severity: (day) => {
      const kts = parseWindKts(day.windSpeedText);
      if (kts == null) return undefined;
      const threshold = getRequirement(22).threshold!; // 40 kt
      // Lower effective threshold (20kt) applies when the day's low temp
      // is below freezing, per the requirement's own text.
      const effectiveThreshold = day.tempLowF != null && day.tempLowF <= 32 ? 20 : threshold;
      return ramp(kts, effectiveThreshold - 10, effectiveThreshold + 5);
    },
  },
];

export interface DayPovResult {
  date: string;
  povPercent: number;
  primaryConcerns: string[];
}

export function computeDayPov(day: DailyForecastEntry): DayPovResult {
  const severities: { no: number; label: string; severity: number }[] = [];
  for (const rule of SCOPED_RULES) {
    const s = rule.severity(day);
    if (s != null) severities.push({ no: rule.no, label: rule.label, severity: s });
  }

  const combinedClear = severities.reduce((acc, r) => acc * (1 - r.severity), 1);
  const povRaw = Math.round((1 - combinedClear) * 100);
  const povPercent = severities.length === 0 ? 0 : Math.max(5, Math.min(95, povRaw));

  const primaryConcerns = severities
    .filter((r) => r.severity > 0.15)
    .sort((a, b) => b.severity - a.severity)
    .map((r) => `${r.label} [LWCCR ${r.no}]`);

  return { date: day.date, povPercent, primaryConcerns };
}

export { LWCC_REQUIREMENTS };

// v8.1 Section 3.2 - Launch Window Favorability Analysis. Derived from
// Tier (d)'s 30-year climate normals (a monthly AVERAGE, not a forecast),
// so this is necessarily coarser than the per-day PoV above and must not be
// presented with false day-level precision (Section 2's own instruction,
// applied here too) - it answers "which months are typically favorable at
// this site," not "will LWCCR X be violated on a specific date."
// Methodology: reuse the same ramp() severity approach as computeDayPov,
// but only against the two temperature-keyed LWCCR thresholds (14, 15) -
// the requirements a monthly average high/low can meaningfully speak to.
// Precipitation normals are not converted into a violation-probability
// figure here (a monthly total inches figure has no defensible mapping to
// "probability precipitation occurs during a launch window" without a
// daily distribution this dataset doesn't provide) - avgPrecipIn is
// reported alongside the favorability score for reference only.
import type { MonthlyClimateNormal } from "./metoc";

export interface MonthFavorability {
  month: number;
  monthName: string;
  favorabilityPct: number; // 0-100, higher = historically more favorable
  avgHighF?: number;
  avgLowF?: number;
  avgPrecipIn?: number;
}

export function computeMonthlyFavorability(normals: MonthlyClimateNormal[]): MonthFavorability[] {
  return normals.map((n) => {
    let riskSeverity = 0;
    if (n.avgLowF != null) {
      const thresholdF = cToF(getRequirement(15).threshold!); // 20F
      riskSeverity = Math.max(riskSeverity, ramp(n.avgLowF, thresholdF + 10, thresholdF - 5));
      riskSeverity = Math.max(riskSeverity, ramp(n.avgLowF, 25, 15)); // LWCCR 14 low band
    }
    if (n.avgHighF != null) {
      riskSeverity = Math.max(riskSeverity, ramp(n.avgHighF, 100, 110)); // LWCCR 14 high band
    }
    return {
      month: n.month,
      monthName: n.monthName,
      favorabilityPct: Math.round((1 - riskSeverity) * 100),
      avgHighF: n.avgHighF,
      avgLowF: n.avgLowF,
      avgPrecipIn: n.avgPrecipIn,
    };
  });
}
