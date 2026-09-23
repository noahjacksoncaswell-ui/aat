import type { WindBand } from "./types";

const KTS_TO_MS = 0.514444;

// Circular (shortest-path) linear interpolation for compass directions, so
// interpolating e.g. 350deg -> 10deg crosses through 0/360 rather than the
// long way around through 180.
function interpolateDirectionDeg(a: number, b: number, f: number): number {
  const diff = (((b - a + 180) % 360) + 360) % 360 - 180;
  return (((a + diff * f) % 360) + 360) % 360;
}

export interface WindVectorMs {
  eastMs: number;
  northMs: number;
}

/**
 * Resolves a wind vector (horizontal drift, ENU east/north components) at a
 * given AGL altitude, linearly interpolating between the altitude-banded
 * samples per Section 4.3 (bands already resolved for blank-field fallback
 * by the caller - this module only interpolates what it is given). Bands
 * must be sorted ascending by altitudeM.
 */
export function resolveWindAt(altitudeAglM: number, bands: WindBand[]): WindVectorMs {
  if (bands.length === 0) return { eastMs: 0, northMs: 0 };
  const h = Math.max(0, altitudeAglM);

  let lower = bands[0];
  let upper = bands[bands.length - 1];
  if (h <= bands[0].altitudeM) {
    lower = upper = bands[0];
  } else if (h >= bands[bands.length - 1].altitudeM) {
    lower = upper = bands[bands.length - 1];
  } else {
    for (let i = 0; i < bands.length - 1; i++) {
      if (h >= bands[i].altitudeM && h <= bands[i + 1].altitudeM) {
        lower = bands[i];
        upper = bands[i + 1];
        break;
      }
    }
  }

  const span = upper.altitudeM - lower.altitudeM;
  const f = span > 0 ? (h - lower.altitudeM) / span : 0;
  const speedKts = lower.speedKts + (upper.speedKts - lower.speedKts) * f;
  const directionFromDeg = interpolateDirectionDeg(lower.directionFromDeg, upper.directionFromDeg, f);

  // Direction is where the wind comes FROM; it blows TOWARD the reciprocal
  // heading. Compass heading -> ENU unit vector: east = sin(theta), north = cos(theta).
  const towardDeg = (directionFromDeg + 180) % 360;
  const towardRad = (towardDeg * Math.PI) / 180;
  const speedMs = speedKts * KTS_TO_MS;

  return {
    eastMs: speedMs * Math.sin(towardRad),
    northMs: speedMs * Math.cos(towardRad),
  };
}

/**
 * Builds the resolved 4-band wind table (surface, 25%, 50%, 100% of
 * predicted apogee) from the raw form inputs, applying Section 4.3's blank-
 * field fallback rules. `predictedApogeeM` comes from the Section 5.1 pre-
 * pass run.
 */
export function resolveWindBands(
  predictedApogeeM: number,
  surface: { speedKts: number; directionFromDeg: number },
  band25: { speedKts?: number; directionFromDeg?: number } | undefined,
  band50: { speedKts?: number; directionFromDeg?: number } | undefined,
  band100: { speedKts?: number; directionFromDeg?: number } | undefined
): WindBand[] {
  const resolved25 =
    band25?.speedKts != null && band25?.directionFromDeg != null
      ? { speedKts: band25.speedKts, directionFromDeg: band25.directionFromDeg }
      : { speedKts: surface.speedKts, directionFromDeg: surface.directionFromDeg };

  const resolved100 =
    band100?.speedKts != null && band100?.directionFromDeg != null
      ? { speedKts: band100.speedKts, directionFromDeg: band100.directionFromDeg }
      : { speedKts: surface.speedKts, directionFromDeg: surface.directionFromDeg };

  const resolved50 =
    band50?.speedKts != null && band50?.directionFromDeg != null
      ? { speedKts: band50.speedKts, directionFromDeg: band50.directionFromDeg }
      : {
          speedKts: (resolved25.speedKts + resolved100.speedKts) / 2,
          directionFromDeg: interpolateDirectionDeg(resolved25.directionFromDeg, resolved100.directionFromDeg, 0.5),
        };

  return [
    { altitudeM: 0, speedKts: surface.speedKts, directionFromDeg: surface.directionFromDeg },
    { altitudeM: predictedApogeeM * 0.25, ...resolved25 },
    { altitudeM: predictedApogeeM * 0.5, ...resolved50 },
    { altitudeM: predictedApogeeM * 1.0, ...resolved100 },
  ];
}
