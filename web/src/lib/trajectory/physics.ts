// v6.0 Section 5 - point-mass trajectory simulation engine. Pure functions,
// no UI/React dependencies, so this can be built and unit-verified in
// isolation per Section 10 before any results-view wiring.
//
// State vector: [xEast, yNorth, zUp, vEast, vNorth, vUp] - the vehicle's own
// kinematic velocity, in meters and m/s, local ENU frame centered on the
// launch site at its own elevation (z = altitude AGL).
//
// Wind drift (Section 5.2) is applied only to the *position* derivative, not
// accumulated into the velocity state itself: the air mass is treated as
// translating horizontally under the vehicle (the same simplified treatment
// OpenRocket/RASAero use, per the directive), so drag continues to act on
// the vehicle's own airspeed while horizontal displacement gains an
// additional wind-driven term each step. Feeding wind into the velocity
// state directly would compound it every step into an unbounded, non-
// physical horizontal acceleration - this formulation is the one that
// actually produces a bounded, textbook drift pattern.

import { atmosphereAt, GRAVITY_MS2 } from "./atmosphere";
import { resolveWindAt } from "./wind";
import type { DescentConfig, EventName, FlightEvent, FlightPhase, PhaseSummary, SimConfig, SimResult, TimeSeriesPoint } from "./types";

type StateVec = [number, number, number, number, number, number]; // x,y,z,vx,vy,vz

function massAt(tS: number, wetMassKg: number, dryMassKg: number, burnTimeS: number): number {
  if (tS >= burnTimeS) return dryMassKg;
  const frac = Math.max(0, tS) / burnTimeS;
  return wetMassKg - (wetMassKg - dryMassKg) * frac;
}

function referenceArea(diameterM: number): number {
  return Math.PI * Math.pow(diameterM / 2, 2);
}

function descentPhaseFor(descent: DescentConfig, mainDeployed: boolean): FlightPhase {
  switch (descent.kind) {
    case "A":
      return "DESCENT_MAIN";
    case "B":
      return mainDeployed ? "DESCENT_MAIN" : "DESCENT_DROGUE";
    case "C":
      return mainDeployed ? "DESCENT_MAIN" : "DESCENT_GUIDED";
    case "D":
      return "DESCENT_BALLISTIC";
    case "E":
      return "DESCENT_CUSTOM";
  }
}

function cdAreaFor(phase: FlightPhase, config: SimConfig): { cd: number; area: number } {
  const vehicleArea = referenceArea(config.vehicle.referenceDiameterM);
  switch (phase) {
    case "POWERED_ASCENT":
    case "UNPOWERED_ASCENT":
    case "DESCENT_BALLISTIC":
      return { cd: config.vehicle.dragCoefficient, area: vehicleArea };
    case "DESCENT_MAIN": {
      const d = config.descent as Extract<DescentConfig, { kind: "A" | "B" | "C" }>;
      return { cd: d.mainCd, area: d.mainArea };
    }
    case "DESCENT_DROGUE": {
      const d = config.descent as Extract<DescentConfig, { kind: "B" }>;
      return { cd: d.drogueCd, area: d.drogueArea };
    }
    case "DESCENT_GUIDED": {
      const d = config.descent as Extract<DescentConfig, { kind: "C" }>;
      return { cd: d.guidedCd, area: d.guidedArea };
    }
    case "DESCENT_CUSTOM": {
      const d = config.descent as Extract<DescentConfig, { kind: "E" }>;
      return { cd: d.customCd, area: d.customArea };
    }
  }
}

function headingUnitVector(railAngleDeg: number, launchAzimuthDeg: number): { e: number; n: number; u: number } {
  const railRad = (railAngleDeg * Math.PI) / 180;
  const azRad = (launchAzimuthDeg * Math.PI) / 180;
  return {
    e: Math.sin(railRad) * Math.sin(azRad),
    n: Math.sin(railRad) * Math.cos(azRad),
    u: Math.cos(railRad),
  };
}

function derivative(tS: number, y: StateVec, phase: FlightPhase, config: SimConfig): StateVec {
  const [x, y_, z, vx, vy, vz] = y;
  const altitudeAgl = Math.max(0, z);
  const atmo = atmosphereAt(altitudeAgl, config.atmosphere.surfaceTempK, config.atmosphere.surfacePressurePa);
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const mass = massAt(tS, config.vehicle.wetMassKg, config.vehicle.dryMassKg, config.vehicle.burnTimeS);
  const { cd, area } = cdAreaFor(phase, config);
  const dragMag = 0.5 * atmo.densityKgM3 * speed * speed * cd * area;
  const dragAccelMag = dragMag / mass;

  let ax = 0;
  let ay = 0;
  let az = -GRAVITY_MS2;

  if (speed > 0) {
    ax -= dragAccelMag * (vx / speed);
    ay -= dragAccelMag * (vy / speed);
    az -= dragAccelMag * (vz / speed);
  }

  if (phase === "POWERED_ASCENT") {
    const thrustMag = config.vehicle.totalImpulseNs / config.vehicle.burnTimeS;
    const heading = headingUnitVector(config.vehicle.railAngleDeg, config.vehicle.launchAzimuthDeg);
    const thrustAccel = thrustMag / mass;
    ax += thrustAccel * heading.e;
    ay += thrustAccel * heading.n;
    az += thrustAccel * heading.u;
  }

  const wind = resolveWindAt(altitudeAgl, config.windBands);

  return [vx + wind.eastMs, vy + wind.northMs, vz, ax, ay, az];
}

function rk4Step(tS: number, y: StateVec, dt: number, phase: FlightPhase, config: SimConfig): StateVec {
  const k1 = derivative(tS, y, phase, config);
  const y2 = addScaled(y, k1, dt / 2);
  const k2 = derivative(tS + dt / 2, y2, phase, config);
  const y3 = addScaled(y, k2, dt / 2);
  const k3 = derivative(tS + dt / 2, y3, phase, config);
  const y4 = addScaled(y, k3, dt);
  const k4 = derivative(tS + dt, y4, phase, config);

  return y.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])) as StateVec;
}

function addScaled(y: StateVec, k: StateVec, scale: number): StateVec {
  return y.map((v, i) => v + k[i] * scale) as StateVec;
}

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

function pointFrom(tS: number, y: StateVec, phase: FlightPhase, config: SimConfig): TimeSeriesPoint {
  const [x, yN, z, vx, vy, vz] = y;
  const altitudeAgl = Math.max(0, z);
  const atmo = atmosphereAt(altitudeAgl, config.atmosphere.surfaceTempK, config.atmosphere.surfacePressurePa);
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const vHorizontal = Math.sqrt(vx * vx + vy * vy);
  const mass = massAt(tS, config.vehicle.wetMassKg, config.vehicle.dryMassKg, config.vehicle.burnTimeS);
  const azRad = (config.vehicle.launchAzimuthDeg * Math.PI) / 180;
  const downrangeM = x * Math.sin(azRad) + yN * Math.cos(azRad);
  const crossrangeM = x * Math.cos(azRad) - yN * Math.sin(azRad);
  const d = derivative(tS, y, phase, config);
  const accelMs2 = Math.sqrt(d[3] * d[3] + d[4] * d[4] + d[5] * d[5]);

  return {
    tS,
    phase,
    xEastM: x,
    yNorthM: yN,
    zUpM: z,
    vEastMs: vx,
    vNorthMs: vy,
    vUpMs: vz,
    speedMs: speed,
    vVerticalMs: vz,
    vHorizontalMs: vHorizontal,
    accelMs2,
    qPa: 0.5 * atmo.densityKgM3 * speed * speed,
    mach: speed / atmo.speedOfSoundMs,
    massKg: mass,
    downrangeM,
    crossrangeM,
  };
}

export interface RunOptions {
  /** Safety cap on simulated flight duration, seconds. */
  maxDurationS?: number;
}

/**
 * Runs the full-resolution simulation. `config.windBands` should already be
 * fully resolved (Section 4.3 fallback rules applied by the caller via
 * wind.ts's resolveWindBands) before calling this.
 */
export function runSimulation(config: SimConfig, options: RunOptions = {}): SimResult {
  const maxDurationS = options.maxDurationS ?? 3600;
  const dt = config.timestepS;
  const { burnTimeS } = config.vehicle;

  let t = 0;
  let state: StateVec = [0, 0, 0, 0, 0, 0];
  let phase: FlightPhase = "POWERED_ASCENT";
  let apogeeReached = false;
  let mainDeployed = false;
  let burnoutRecorded = false;

  const timeSeries: TimeSeriesPoint[] = [];
  const events: FlightEvent[] = [];

  const pushEvent = (name: EventName, tS: number, y: StateVec) => {
    const p = pointFrom(tS, y, phase, config);
    events.push({ name, tS, altitudeM: p.zUpM, speedMs: p.speedMs, downrangeM: p.downrangeM });
  };

  timeSeries.push(pointFrom(t, state, phase, config));
  pushEvent("LIFTOFF", 0, state);

  let apogeeAltitudeM = 0;
  let apogeeTimeS = 0;

  while (t < maxDurationS) {
    // Phase for the step about to be taken, decided from state already known.
    if (t < burnTimeS) {
      phase = "POWERED_ASCENT";
    } else if (!apogeeReached) {
      phase = "UNPOWERED_ASCENT";
    } else {
      phase = descentPhaseFor(config.descent, mainDeployed);
    }

    const prevT = t;
    const prevState = state;
    const nextState = rk4Step(t, state, dt, phase, config);
    const nextT = t + dt;

    if (!burnoutRecorded && prevT < burnTimeS && nextT >= burnTimeS) {
      burnoutRecorded = true;
      pushEvent("BURNOUT", burnTimeS, nextState);
    }

    if (!apogeeReached && phase === "UNPOWERED_ASCENT" && prevState[5] > 0 && nextState[5] <= 0) {
      apogeeReached = true;
      const f = prevState[5] / (prevState[5] - nextState[5]);
      const apogeeT = lerp(prevT, nextT, f);
      const apogeeState = prevState.map((v, i) => lerp(v, nextState[i], f)) as StateVec;
      apogeeTimeS = apogeeT;
      apogeeAltitudeM = apogeeState[2];
      pushEvent("APOGEE", apogeeT, apogeeState);
      if (config.descent.kind === "B") pushEvent("DROGUE_DEPLOY", apogeeT, apogeeState);
      if (config.descent.kind === "C") pushEvent("GUIDED_DESCENT_BEGIN", apogeeT, apogeeState);
      if (config.descent.kind === "A") pushEvent("MAIN_DEPLOY", apogeeT, apogeeState);
    }

    if (apogeeReached && !mainDeployed && (config.descent.kind === "B" || config.descent.kind === "C")) {
      const deployAlt = config.descent.mainDeployAltitudeM;
      if (prevState[2] > deployAlt && nextState[2] <= deployAlt) {
        mainDeployed = true;
        const f = (prevState[2] - deployAlt) / (prevState[2] - nextState[2]);
        const deployT = lerp(prevT, nextT, f);
        const deployState = prevState.map((v, i) => lerp(v, nextState[i], f)) as StateVec;
        if (config.descent.kind === "C") pushEvent("GUIDED_DESCENT_END", deployT, deployState);
        pushEvent("MAIN_DEPLOY", deployT, deployState);
      }
    }

    if (apogeeReached && nextState[2] <= 0) {
      const f = prevState[2] / (prevState[2] - nextState[2]);
      const touchdownT = lerp(prevT, nextT, f);
      const touchdownState = prevState.map((v, i) => lerp(v, nextState[i], f)) as StateVec;
      touchdownState[2] = 0;
      phase = descentPhaseFor(config.descent, mainDeployed);
      t = touchdownT;
      state = touchdownState;
      timeSeries.push(pointFrom(t, state, phase, config));
      pushEvent("TOUCHDOWN", t, state);
      break;
    }

    t = nextT;
    state = nextState;
    timeSeries.push(pointFrom(t, state, phase, config));
  }

  return {
    timeSeries,
    events,
    phaseSummaries: buildPhaseSummaries(timeSeries),
    apogeeAltitudeM,
    apogeeTimeS,
  };
}

/**
 * Quick pre-pass (Section 5.1) to estimate apogee altitude before altitude-
 * banded wind can be resolved. Wind does not affect vertical motion in this
 * model (Section 5.2's drift term is horizontal-only), so the pre-pass can
 * safely ignore wind entirely and still produce the correct apogee estimate
 * the full run will reproduce.
 */
export function estimateApogee(config: Omit<SimConfig, "windBands" | "timestepS">, coarseTimestepS = 0.1): { apogeeAltitudeM: number; apogeeTimeS: number } {
  const result = runSimulation({ ...config, windBands: [], timestepS: coarseTimestepS });
  return { apogeeAltitudeM: result.apogeeAltitudeM, apogeeTimeS: result.apogeeTimeS };
}

function buildPhaseSummaries(timeSeries: TimeSeriesPoint[]): PhaseSummary[] {
  const summaries: PhaseSummary[] = [];
  let current: PhaseSummary | null = null;

  for (const p of timeSeries) {
    if (!current || current.phase !== p.phase) {
      if (current) summaries.push(current);
      current = {
        phase: p.phase,
        startS: p.tS,
        endS: p.tS,
        durationS: 0,
        startAltitudeM: p.zUpM,
        endAltitudeM: p.zUpM,
        maxVelocityMs: p.speedMs,
      };
    }
    current.endS = p.tS;
    current.durationS = current.endS - current.startS;
    current.endAltitudeM = p.zUpM;
    current.maxVelocityMs = Math.max(current.maxVelocityMs, p.speedMs);
  }
  if (current) summaries.push(current);
  return summaries;
}

/** Instantaneous thrust magnitude (N) - constant during Phase 1, zero otherwise. Used for the Thrust vs. Time graph (Section 6.2). */
export function thrustAt(tS: number, config: SimConfig): number {
  return tS <= config.vehicle.burnTimeS ? config.vehicle.totalImpulseNs / config.vehicle.burnTimeS : 0;
}

export { referenceArea };
