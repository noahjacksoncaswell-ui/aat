// v6.0 Section 5.2 - single-layer (troposphere) International Standard
// Atmosphere model, adjusted by the user's entered surface temperature and
// pressure (Section 4.3) at the launch site's own elevation, with the
// standard lapse rate applied above it. Hand-derived per Section 5.2's
// instruction ("if the agent's chosen physics/atmosphere library already
// implements the standard atmosphere model, use it rather than hand-
// deriving one") - no such library exists in this project's dependencies,
// and the formula itself is a fixed, textbook constant set, not a design
// choice.

const LAPSE_RATE_K_PER_M = 0.0065; // ISA standard lapse rate, troposphere
const GRAVITY_MS2 = 9.81;
const MOLAR_MASS_AIR_KG_MOL = 0.0289644;
const UNIVERSAL_GAS_CONST = 8.31432; // J/(mol*K)
const SPECIFIC_GAS_CONST_AIR = 287.05287; // J/(kg*K)
const GAMMA_AIR = 1.4;
// ISA troposphere ceiling (11 km above the reference surface); above this,
// held isothermal. Comfortably covers sounding-rocket-class flight profiles.
const TROPOPAUSE_M = 11000;

export const STANDARD_SURFACE_TEMP_K = 288.15; // 59 F
export const STANDARD_SURFACE_PRESSURE_PA = 101325; // 29.92 inHg

export function fahrenheitToKelvin(f: number): number {
  return ((f - 32) * 5) / 9 + 273.15;
}

export function inHgToPa(inHg: number): number {
  return inHg * 3386.389;
}

export interface AtmosphereState {
  temperatureK: number;
  pressurePa: number;
  densityKgM3: number;
  speedOfSoundMs: number;
}

/**
 * @param altitudeAglM altitude above the launch site's own elevation (the
 *   simulation's local ground reference, Section 5.2)
 * @param surfaceTempK temperature at the launch site's elevation (already
 *   defaulted by the caller to STANDARD_SURFACE_TEMP_K if left blank)
 * @param surfacePressurePa pressure at the launch site's elevation (already
 *   defaulted by the caller to STANDARD_SURFACE_PRESSURE_PA if left blank)
 */
export function atmosphereAt(altitudeAglM: number, surfaceTempK: number, surfacePressurePa: number): AtmosphereState {
  const h = Math.max(0, altitudeAglM);
  let temperatureK: number;
  let pressurePa: number;

  if (h <= TROPOPAUSE_M) {
    temperatureK = surfaceTempK - LAPSE_RATE_K_PER_M * h;
    const exponent = (GRAVITY_MS2 * MOLAR_MASS_AIR_KG_MOL) / (UNIVERSAL_GAS_CONST * LAPSE_RATE_K_PER_M);
    pressurePa = surfacePressurePa * Math.pow(temperatureK / surfaceTempK, exponent);
  } else {
    const tTropopause = surfaceTempK - LAPSE_RATE_K_PER_M * TROPOPAUSE_M;
    const exponent = (GRAVITY_MS2 * MOLAR_MASS_AIR_KG_MOL) / (UNIVERSAL_GAS_CONST * LAPSE_RATE_K_PER_M);
    const pTropopause = surfacePressurePa * Math.pow(tTropopause / surfaceTempK, exponent);
    temperatureK = tTropopause;
    pressurePa = pTropopause * Math.exp((-GRAVITY_MS2 * MOLAR_MASS_AIR_KG_MOL * (h - TROPOPAUSE_M)) / (UNIVERSAL_GAS_CONST * tTropopause));
  }

  const densityKgM3 = pressurePa / (SPECIFIC_GAS_CONST_AIR * temperatureK);
  const speedOfSoundMs = Math.sqrt(GAMMA_AIR * SPECIFIC_GAS_CONST_AIR * temperatureK);

  return { temperatureK, pressurePa, densityKgM3, speedOfSoundMs };
}

export { GRAVITY_MS2 };
