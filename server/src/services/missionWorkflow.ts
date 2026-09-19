export function isSameUtcDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function isTodayOrPast(date: Date, now: Date = new Date()): boolean {
  return isSameUtcDate(date, now) || date < now;
}

// Revision Directive v3.0 Section 6.3 - Polls tab station list, replacing
// the prior six-station set.
export const STANDARD_GO_NO_GO_STATIONS = [
  "Avionics",
  "Propulsion",
  "Telemetry",
  "Staging",
  "Recovery",
  "Ground Systems/LCS",
  "Pad",
  "Ops Support",
  "Communications",
  "Range",
  "FAA/Airspace",
] as const;

export const FAA_STATION_NAME = "FAA/Airspace";
