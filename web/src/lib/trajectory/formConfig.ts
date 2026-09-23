// v6.0 Section 4 - pure form-state types, defaults, and validation/
// conversion logic bridging the configuration form to the physics engine's
// SimConfig. Kept separate from the form's React component so the
// conversion/validation logic itself stays easy to reason about and test.

import { fahrenheitToKelvin, inHgToPa, STANDARD_SURFACE_PRESSURE_PA, STANDARD_SURFACE_TEMP_K } from "./atmosphere";
import { estimateApogee, referenceArea, runSimulation } from "./physics";
import { resolveWindBands } from "./wind";
import type { DescentConfig, SimConfig, SimResult } from "./types";

export type DescentKind = "A" | "B" | "C" | "D" | "E";
export type MapType = "street" | "satellite" | "topo" | "aviation";
export type DiameterUnit = "m" | "cm" | "in";

// Section 4.2 defaults
export const DEFAULT_ASCENT_CD = 0.5;
export const DEFAULT_MAIN_CD = 1.5;
export const DEFAULT_DROGUE_CD = 1.2;
export const DEFAULT_GUIDED_CD = 0.9;

export interface TrajectoryFormState {
  // Populate-from-registry control
  populateVehicleId: string;

  // Section (i) - Vehicle Information
  wetMassKg: string;
  dryMassKg: string;
  totalImpulseNs: string;
  burnTimeS: string;
  referenceDiameter: string;
  referenceDiameterUnit: DiameterUnit;
  dragCoefficient: string; // optional, default 0.5
  railAngleDeg: string;
  launchAzimuthDeg: string;

  // Section (ii) - Descent Configuration
  descentKind: DescentKind;
  mainCd: string; // optional, default 1.5 (A/B/C)
  mainArea: string; // required (A/B/C)
  drogueCd: string; // optional, default 1.2 (B)
  drogueArea: string; // required (B)
  mainDeployAltitudeM: string; // required (B/C)
  guidedCd: string; // optional, default 0.9 (C)
  guidedArea: string; // required (C) - defaults to vehicle reference area unless overridden
  customCd: string; // required, no default (E)
  customArea: string; // required (E)

  // Section (iii) - Weather
  surfaceWindSpeedKts: string;
  surfaceWindDirDeg: string;
  wind25SpeedKts: string;
  wind25DirDeg: string;
  wind50SpeedKts: string;
  wind50DirDeg: string;
  wind100SpeedKts: string;
  wind100DirDeg: string;
  surfaceTempF: string; // optional, default 59
  surfacePressureInHg: string; // optional, default 29.92

  // Section (iv) - Launch Site
  siteId: string;

  // Section (v) - Map Type
  mapType: MapType;

  // Section (vi) - Confirmation
  confirmed: boolean;
}

export function emptyFormState(): TrajectoryFormState {
  return {
    populateVehicleId: "",
    wetMassKg: "",
    dryMassKg: "",
    totalImpulseNs: "",
    burnTimeS: "",
    referenceDiameter: "",
    referenceDiameterUnit: "m",
    dragCoefficient: "",
    railAngleDeg: "0",
    launchAzimuthDeg: "",
    descentKind: "A",
    mainCd: "",
    mainArea: "",
    drogueCd: "",
    drogueArea: "",
    mainDeployAltitudeM: "",
    guidedCd: "",
    guidedArea: "",
    customCd: "",
    customArea: "",
    surfaceWindSpeedKts: "",
    surfaceWindDirDeg: "",
    wind25SpeedKts: "",
    wind25DirDeg: "",
    wind50SpeedKts: "",
    wind50DirDeg: "",
    wind100SpeedKts: "",
    wind100DirDeg: "",
    surfaceTempF: "",
    surfacePressureInHg: "",
    siteId: "",
    mapType: "street",
    confirmed: false,
  };
}

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function diameterToMeters(value: number, unit: DiameterUnit): number {
  if (unit === "m") return value;
  if (unit === "cm") return value / 100;
  return value * 0.0254; // in
}

export interface SiteOrigin {
  lat: number;
  lon: number;
  elevationM: number;
}

export interface ActiveCoaInfo {
  authorizedOperationRadiusNm: number;
  altitudeLimits: string;
  altitudeLimitFeet: number | null; // parsed numeric portion, if the free-text field yields one
}

export interface RunMeta {
  populatedVehicleId: string | null;
  populatedVehicleName: string | null;
  siteId: string;
  siteName: string;
  siteDesignator: string;
  origin: SiteOrigin;
  activeCoa: ActiveCoaInfo | null;
  mapType: MapType;
  runAt: string; // ISO timestamp
}

export interface BuildConfigResult {
  ok: true;
  config: SimConfig;
  meta: Omit<RunMeta, "runAt">;
}
export interface BuildConfigError {
  ok: false;
  errors: string[];
}

/**
 * Attempts to parse an FAA COA's free-text Altitude Limit field (Section
 * 2.1 of the v4.0 directive - always a String in this schema) for a leading
 * numeric value in feet, for the 3D COA cylinder's height (Section 6.1).
 * Falls back to null if no plausible numeric prefix is found; the caller
 * omits the cylinder rather than guess at ambiguous text.
 */
export function parseAltitudeLimitFeet(text: string): number | null {
  const match = text.match(/[\d,]+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function validateAndBuildConfig(
  form: TrajectoryFormState,
  site: { id: string; name: string; designator: string; lat: number; lon: number; elevationMeters?: number | null } | null,
  activeCoa: ActiveCoaInfo | null,
  populatedVehicleName: string | null,
  timestepS = 0.02
): BuildConfigResult | BuildConfigError {
  const errors: string[] = [];

  const wetMassKg = num(form.wetMassKg);
  const dryMassKg = num(form.dryMassKg);
  const totalImpulseNs = num(form.totalImpulseNs);
  const burnTimeS = num(form.burnTimeS);
  const referenceDiameterRaw = num(form.referenceDiameter);
  const railAngleDeg = num(form.railAngleDeg);
  const launchAzimuthDeg = num(form.launchAzimuthDeg);

  if (wetMassKg == null || wetMassKg <= 0) errors.push("Wet Mass is required and must be a positive number.");
  if (dryMassKg == null || dryMassKg <= 0) errors.push("Dry Mass is required and must be a positive number.");
  if (wetMassKg != null && dryMassKg != null && dryMassKg > wetMassKg) errors.push("Dry Mass cannot exceed Wet Mass.");
  if (totalImpulseNs == null || totalImpulseNs <= 0) errors.push("Total Impulse is required and must be a positive number.");
  if (burnTimeS == null || burnTimeS <= 0) errors.push("Burn Time is required and must be a positive number.");
  if (referenceDiameterRaw == null || referenceDiameterRaw <= 0) errors.push("Reference Diameter is required and must be a positive number.");
  if (railAngleDeg == null || railAngleDeg < 0 || railAngleDeg > 90) errors.push("Launch Rail/Rod Angle must be between 0 and 90 degrees.");
  if (launchAzimuthDeg == null || launchAzimuthDeg < 0 || launchAzimuthDeg > 360) errors.push("Launch Azimuth is required and must be between 0 and 360 degrees.");

  const dragCoefficient = num(form.dragCoefficient) ?? DEFAULT_ASCENT_CD;
  const referenceDiameterM = referenceDiameterRaw != null ? diameterToMeters(referenceDiameterRaw, form.referenceDiameterUnit) : 0;

  let descent: DescentConfig | null = null;
  const vehicleAreaFallback = referenceDiameterM > 0 ? referenceArea(referenceDiameterM) : 0;

  if (form.descentKind === "A") {
    const mainArea = num(form.mainArea);
    if (mainArea == null || mainArea <= 0) errors.push("Main Chute Reference Area is required for Descent Option A.");
    descent = { kind: "A", mainCd: num(form.mainCd) ?? DEFAULT_MAIN_CD, mainArea: mainArea ?? 0 };
  } else if (form.descentKind === "B") {
    const drogueArea = num(form.drogueArea);
    const mainArea = num(form.mainArea);
    const mainDeployAltitudeM = num(form.mainDeployAltitudeM);
    if (drogueArea == null || drogueArea <= 0) errors.push("Drogue Reference Area is required for Descent Option B.");
    if (mainArea == null || mainArea <= 0) errors.push("Main Chute Reference Area is required for Descent Option B.");
    if (mainDeployAltitudeM == null || mainDeployAltitudeM <= 0) errors.push("Main Deploy Altitude is required for Descent Option B.");
    descent = {
      kind: "B",
      drogueCd: num(form.drogueCd) ?? DEFAULT_DROGUE_CD,
      drogueArea: drogueArea ?? 0,
      mainDeployAltitudeM: mainDeployAltitudeM ?? 0,
      mainCd: num(form.mainCd) ?? DEFAULT_MAIN_CD,
      mainArea: mainArea ?? 0,
    };
  } else if (form.descentKind === "C") {
    const guidedArea = num(form.guidedArea) ?? vehicleAreaFallback;
    const mainArea = num(form.mainArea);
    const mainDeployAltitudeM = num(form.mainDeployAltitudeM);
    if (mainArea == null || mainArea <= 0) errors.push("Main Chute Reference Area is required for Descent Option C.");
    if (mainDeployAltitudeM == null || mainDeployAltitudeM <= 0) errors.push("Main Deploy Altitude is required for Descent Option C.");
    descent = {
      kind: "C",
      guidedCd: num(form.guidedCd) ?? DEFAULT_GUIDED_CD,
      guidedArea,
      mainDeployAltitudeM: mainDeployAltitudeM ?? 0,
      mainCd: num(form.mainCd) ?? DEFAULT_MAIN_CD,
      mainArea: mainArea ?? 0,
    };
  } else if (form.descentKind === "D") {
    descent = { kind: "D" };
  } else {
    const customCd = num(form.customCd);
    const customArea = num(form.customArea);
    if (customCd == null || customCd <= 0) errors.push("Custom Descent Cd is required for Descent Option E.");
    if (customArea == null || customArea <= 0) errors.push("Custom Descent Reference Area is required for Descent Option E.");
    descent = { kind: "E", customCd: customCd ?? 0, customArea: customArea ?? 0 };
  }

  const surfaceWindSpeedKts = num(form.surfaceWindSpeedKts);
  const surfaceWindDirDeg = num(form.surfaceWindDirDeg);
  if (surfaceWindSpeedKts == null || surfaceWindSpeedKts < 0) errors.push("Surface Wind Speed is required.");
  if (surfaceWindDirDeg == null || surfaceWindDirDeg < 0 || surfaceWindDirDeg > 360) errors.push("Surface Wind Direction is required and must be between 0 and 360 degrees.");

  if (!site) errors.push("A Launch Site selection is required.");
  if (!form.confirmed) errors.push("The confirmation checkbox must be checked before beginning the simulation.");

  if (errors.length > 0 || !site) return { ok: false, errors };

  const surfaceTempK = num(form.surfaceTempF) != null ? fahrenheitToKelvin(num(form.surfaceTempF)!) : STANDARD_SURFACE_TEMP_K;
  const surfacePressurePa = num(form.surfacePressureInHg) != null ? inHgToPa(num(form.surfacePressureInHg)!) : STANDARD_SURFACE_PRESSURE_PA;

  const vehicle = {
    wetMassKg: wetMassKg!,
    dryMassKg: dryMassKg!,
    totalImpulseNs: totalImpulseNs!,
    burnTimeS: burnTimeS!,
    referenceDiameterM,
    dragCoefficient,
    railAngleDeg: railAngleDeg!,
    launchAzimuthDeg: launchAzimuthDeg!,
  };

  const atmosphere = {
    surfaceTempK,
    surfacePressurePa,
    siteElevationM: site.elevationMeters ?? 0,
  };

  // Section 5.1 pre-pass: estimate apogee (wind-independent, see physics.ts)
  // so the altitude-banded wind values below can be resolved.
  const { apogeeAltitudeM } = estimateApogee({ vehicle, descent: descent!, atmosphere });

  const windBands = resolveWindBands(
    apogeeAltitudeM,
    { speedKts: surfaceWindSpeedKts!, directionFromDeg: surfaceWindDirDeg! },
    num(form.wind25SpeedKts) != null && num(form.wind25DirDeg) != null ? { speedKts: num(form.wind25SpeedKts)!, directionFromDeg: num(form.wind25DirDeg)! } : undefined,
    num(form.wind50SpeedKts) != null && num(form.wind50DirDeg) != null ? { speedKts: num(form.wind50SpeedKts)!, directionFromDeg: num(form.wind50DirDeg)! } : undefined,
    num(form.wind100SpeedKts) != null && num(form.wind100DirDeg) != null ? { speedKts: num(form.wind100SpeedKts)!, directionFromDeg: num(form.wind100DirDeg)! } : undefined
  );

  const config: SimConfig = {
    vehicle,
    descent: descent!,
    atmosphere,
    windBands,
    timestepS,
  };

  return {
    ok: true,
    config,
    meta: {
      populatedVehicleId: form.populateVehicleId || null,
      populatedVehicleName,
      siteId: site.id,
      siteName: site.name,
      siteDesignator: site.designator,
      origin: { lat: site.lat, lon: site.lon, elevationM: site.elevationMeters ?? 0 },
      activeCoa,
      mapType: form.mapType,
    },
  };
}

export function runFullSimulation(config: SimConfig): SimResult {
  return runSimulation(config);
}
