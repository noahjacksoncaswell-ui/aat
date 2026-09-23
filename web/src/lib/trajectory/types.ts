// v6.0 Section 5 - shared types for the point-mass trajectory simulation
// engine. This module has no React/UI dependencies so it can be built and
// unit-verified in isolation (Section 10) before any results-view wiring.

export type FlightPhase =
  | "POWERED_ASCENT"
  | "UNPOWERED_ASCENT"
  | "DESCENT_DROGUE"
  | "DESCENT_GUIDED"
  | "DESCENT_MAIN"
  | "DESCENT_BALLISTIC"
  | "DESCENT_CUSTOM";

// Section 4.2 - the five descent configuration options, discriminated by
// `kind` so each option's own required fields are only present where valid.
export type DescentConfig =
  | { kind: "A"; mainCd: number; mainArea: number }
  | { kind: "B"; drogueCd: number; drogueArea: number; mainDeployAltitudeM: number; mainCd: number; mainArea: number }
  | { kind: "C"; guidedCd: number; guidedArea: number; mainDeployAltitudeM: number; mainCd: number; mainArea: number }
  | { kind: "D" }
  | { kind: "E"; customCd: number; customArea: number };

// A single altitude-band wind sample - direction is the compass heading
// the wind is blowing FROM (meteorological convention), matching the LWCC
// module's existing altitude-banded wind convention (Section 4.3).
export interface WindBand {
  altitudeM: number; // AGL, relative to launch site elevation
  speedKts: number;
  directionFromDeg: number; // 0-360, true north reference
}

export interface VehicleParams {
  wetMassKg: number;
  dryMassKg: number;
  totalImpulseNs: number;
  burnTimeS: number;
  referenceDiameterM: number;
  dragCoefficient: number; // ascent/coast Cd, default 0.5 applied by caller
  railAngleDeg: number; // from vertical, 0 = straight up
  launchAzimuthDeg: number; // from true north, 0-360
}

export interface AtmosphereParams {
  surfaceTempK: number; // default 288.15 K (59 F) applied by caller
  surfacePressurePa: number; // default 101325 Pa (29.92 inHg) applied by caller
  siteElevationM: number;
}

export interface SimConfig {
  vehicle: VehicleParams;
  descent: DescentConfig;
  atmosphere: AtmosphereParams;
  windBands: WindBand[]; // sorted ascending by altitudeM, already resolved (Section 4.3 fallback rules applied by caller)
  timestepS: number; // 0.01-0.05s, Section 5.1
}

export interface TimeSeriesPoint {
  tS: number; // MET, seconds
  phase: FlightPhase;
  // Local ENU position, meters, relative to launch site origin
  xEastM: number;
  yNorthM: number;
  zUpM: number; // altitude AGL
  vEastMs: number;
  vNorthMs: number;
  vUpMs: number;
  speedMs: number; // vehicle's own airspeed magnitude (excludes wind drift)
  vVerticalMs: number;
  vHorizontalMs: number;
  accelMs2: number;
  qPa: number; // dynamic pressure
  mach: number;
  massKg: number;
  downrangeM: number;
  crossrangeM: number;
}

export type EventName =
  | "LIFTOFF"
  | "BURNOUT"
  | "APOGEE"
  | "DROGUE_DEPLOY"
  | "GUIDED_DESCENT_BEGIN"
  | "GUIDED_DESCENT_END"
  | "MAIN_DEPLOY"
  | "TOUCHDOWN";

export interface FlightEvent {
  name: EventName;
  tS: number;
  altitudeM: number;
  speedMs: number;
  downrangeM: number;
}

export interface PhaseSummary {
  phase: FlightPhase;
  startS: number;
  endS: number;
  durationS: number;
  startAltitudeM: number;
  endAltitudeM: number;
  maxVelocityMs: number;
}

export interface SimResult {
  timeSeries: TimeSeriesPoint[];
  events: FlightEvent[];
  phaseSummaries: PhaseSummary[];
  apogeeAltitudeM: number;
  apogeeTimeS: number;
}
