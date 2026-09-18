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

export const STANDARD_GO_NO_GO_STATIONS = [
  "Flight Dynamics",
  "Range Safety",
  "Weather",
  "Vehicle",
  "Recovery",
  "FAA/Airspace",
] as const;

export const FAA_STATION_NAME = "FAA/Airspace";
