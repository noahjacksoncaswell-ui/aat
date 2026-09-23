// v6.0 Section 10 - standalone verification of the trajectory physics
// engine in isolation, before any results-UI wiring, per the directive's
// explicit instruction to treat this module with the same rigor as the
// LWCC evaluation engine and the countdown hold scheduler. Run with:
//   npx tsx scripts/verifyTrajectoryPhysics.ts
// Not a permanent CI-run test suite (this project has no test runner
// configured) - a repeatable regression script, matching the existing
// convention of one-off verification scripts under server/scripts/.

import { runSimulation, estimateApogee } from "../src/lib/trajectory/physics";
import { STANDARD_SURFACE_PRESSURE_PA, STANDARD_SURFACE_TEMP_K } from "../src/lib/trajectory/atmosphere";
import type { SimConfig } from "../src/lib/trajectory/types";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function approx(a: number, b: number, tolPct = 0.02): boolean {
  if (b === 0) return Math.abs(a) < 1e-6;
  return Math.abs(a - b) / Math.abs(b) <= tolPct;
}

const g = 9.81;

// ---------------------------------------------------------------------------
// Case 1: idealized zero-drag, zero-wind, straight-up ballistic shot.
// With no drag, this reduces to textbook constant-acceleration kinematics:
// burnout velocity v_b = a_thrust*burnTime (a_thrust = Thrust/mass - g,
// approximated with a fixed mass since wet=dry here removes mass depletion
// entirely), apogee time = burnTime + v_b/g, apogee altitude computable via
// standard SUVAT. This is the exact hand-calculable case Section 10 asks
// for before adding drag/wind complexity.
// ---------------------------------------------------------------------------
{
  console.log("\nCase 1: zero-drag, zero-wind, vertical ballistic shot");

  const mass = 20; // kg, wet == dry so no mass depletion complicates the hand-calc
  const burnTime = 4; // s
  const thrust = 1200; // N, constant since totalImpulse = thrust*burnTime
  const totalImpulse = thrust * burnTime;

  const config: SimConfig = {
    vehicle: {
      wetMassKg: mass,
      dryMassKg: mass,
      totalImpulseNs: totalImpulse,
      burnTimeS: burnTime,
      referenceDiameterM: 0.15,
      dragCoefficient: 0, // zero drag
      railAngleDeg: 0, // straight up
      launchAzimuthDeg: 0,
    },
    descent: { kind: "D" }, // ballistic, irrelevant here (drag is zero throughout anyway)
    atmosphere: { surfaceTempK: STANDARD_SURFACE_TEMP_K, surfacePressurePa: STANDARD_SURFACE_PRESSURE_PA, siteElevationM: 0 },
    windBands: [{ altitudeM: 0, speedKts: 0, directionFromDeg: 0 }],
    timestepS: 0.01,
  };

  const result = runSimulation(config);

  const aThrust = thrust / mass - g; // net upward accel during burn
  const vBurnout = aThrust * burnTime;
  const altBurnout = 0.5 * aThrust * burnTime * burnTime;
  const coastTime = vBurnout / g;
  const altGainCoast = (vBurnout * vBurnout) / (2 * g);
  const expectedApogeeAlt = altBurnout + altGainCoast;
  const expectedApogeeTime = burnTime + coastTime;

  check(
    "apogee altitude matches SUVAT hand-calc",
    approx(result.apogeeAltitudeM, expectedApogeeAlt, 0.01),
    `got ${result.apogeeAltitudeM.toFixed(2)}m, expected ~${expectedApogeeAlt.toFixed(2)}m`
  );
  check(
    "apogee time matches SUVAT hand-calc",
    approx(result.apogeeTimeS, expectedApogeeTime, 0.01),
    `got ${result.apogeeTimeS.toFixed(2)}s, expected ~${expectedApogeeTime.toFixed(2)}s`
  );

  // Zero drag + zero wind + straight-up heading => trajectory must stay
  // exactly on the vertical axis (no horizontal drift at all).
  const maxHorizontalDrift = Math.max(...result.timeSeries.map((p) => Math.hypot(p.xEastM, p.yNorthM)));
  check("no horizontal drift on a straight-up shot with zero wind", maxHorizontalDrift < 1e-6, `max drift ${maxHorizontalDrift}`);

  // Free-fall descent under zero drag from apogee should take the classic
  // sqrt(2h/g) time back to the ground.
  const touchdown = result.events.find((e) => e.name === "TOUCHDOWN");
  const apogeeEvent = result.events.find((e) => e.name === "APOGEE")!;
  const expectedFallTime = Math.sqrt((2 * result.apogeeAltitudeM) / g);
  check(
    "free-fall descent duration matches sqrt(2h/g)",
    !!touchdown && approx(touchdown.tS - apogeeEvent.tS, expectedFallTime, 0.02),
    touchdown ? `got ${(touchdown.tS - apogeeEvent.tS).toFixed(2)}s, expected ~${expectedFallTime.toFixed(2)}s` : "no touchdown event"
  );

  check("event ordering is LIFTOFF < BURNOUT < APOGEE < TOUCHDOWN", (() => {
    const order = result.events.map((e) => e.name);
    const idx = (n: string) => order.indexOf(n);
    return idx("LIFTOFF") === 0 && idx("BURNOUT") < idx("APOGEE") && idx("APOGEE") < idx("TOUCHDOWN");
  })());
}

// ---------------------------------------------------------------------------
// Case 2: mass depletion sanity check - burnout mass must equal dry mass
// exactly, and mass must decrease monotonically and linearly during burn.
// ---------------------------------------------------------------------------
{
  console.log("\nCase 2: linear mass depletion during powered ascent");

  const config: SimConfig = {
    vehicle: {
      wetMassKg: 25,
      dryMassKg: 15,
      totalImpulseNs: 6000,
      burnTimeS: 3,
      referenceDiameterM: 0.15,
      dragCoefficient: 0.5,
      railAngleDeg: 0,
      launchAzimuthDeg: 0,
    },
    descent: { kind: "D" },
    atmosphere: { surfaceTempK: STANDARD_SURFACE_TEMP_K, surfacePressurePa: STANDARD_SURFACE_PRESSURE_PA, siteElevationM: 0 },
    windBands: [{ altitudeM: 0, speedKts: 0, directionFromDeg: 0 }],
    timestepS: 0.01,
  };

  const result = runSimulation(config);
  const burnoutEvent = result.events.find((e) => e.name === "BURNOUT")!;
  const burnoutPoint = result.timeSeries.reduce((closest, p) => (Math.abs(p.tS - burnoutEvent.tS) < Math.abs(closest.tS - burnoutEvent.tS) ? p : closest));

  check("mass at burnout equals dry mass", approx(burnoutPoint.massKg, 15, 0.02), `got ${burnoutPoint.massKg.toFixed(3)}kg`);

  const poweredPoints = result.timeSeries.filter((p) => p.phase === "POWERED_ASCENT");
  let monotonic = true;
  for (let i = 1; i < poweredPoints.length; i++) {
    if (poweredPoints[i].massKg > poweredPoints[i - 1].massKg + 1e-9) monotonic = false;
  }
  check("mass decreases monotonically during powered ascent", monotonic);
}

// ---------------------------------------------------------------------------
// Case 3: drag must reduce apogee altitude relative to the zero-drag case,
// and increasing Cd must reduce it further - a basic physical sanity check
// once drag is introduced.
// ---------------------------------------------------------------------------
{
  console.log("\nCase 3: drag monotonically reduces apogee altitude");

  const base: SimConfig = {
    vehicle: {
      wetMassKg: 20,
      dryMassKg: 20,
      totalImpulseNs: 4800,
      burnTimeS: 4,
      referenceDiameterM: 0.15,
      dragCoefficient: 0,
      railAngleDeg: 0,
      launchAzimuthDeg: 0,
    },
    descent: { kind: "D" },
    atmosphere: { surfaceTempK: STANDARD_SURFACE_TEMP_K, surfacePressurePa: STANDARD_SURFACE_PRESSURE_PA, siteElevationM: 0 },
    windBands: [{ altitudeM: 0, speedKts: 0, directionFromDeg: 0 }],
    timestepS: 0.02,
  };

  const noDrag = runSimulation(base).apogeeAltitudeM;
  const lowDrag = runSimulation({ ...base, vehicle: { ...base.vehicle, dragCoefficient: 0.4 } }).apogeeAltitudeM;
  const highDrag = runSimulation({ ...base, vehicle: { ...base.vehicle, dragCoefficient: 1.2 } }).apogeeAltitudeM;

  check("zero-drag apogee > low-drag apogee", noDrag > lowDrag, `${noDrag.toFixed(1)}m vs ${lowDrag.toFixed(1)}m`);
  check("low-drag apogee > high-drag apogee", lowDrag > highDrag, `${lowDrag.toFixed(1)}m vs ${highDrag.toFixed(1)}m`);
}

// ---------------------------------------------------------------------------
// Case 4: wind drift - a pure horizontal crosswind with an otherwise
// zero-drag, straight-up shot must land displaced downwind, and doubling
// the wind speed should roughly double the drift (drift is a simple
// additive horizontal term in this model, so response should be linear).
// ---------------------------------------------------------------------------
{
  console.log("\nCase 4: wind drift response");

  const mkConfig = (windKts: number): SimConfig => ({
    vehicle: {
      wetMassKg: 20,
      dryMassKg: 20,
      totalImpulseNs: 4800,
      burnTimeS: 4,
      referenceDiameterM: 0.15,
      dragCoefficient: 0,
      railAngleDeg: 0,
      launchAzimuthDeg: 0,
    },
    descent: { kind: "D" },
    atmosphere: { surfaceTempK: STANDARD_SURFACE_TEMP_K, surfacePressurePa: STANDARD_SURFACE_PRESSURE_PA, siteElevationM: 0 },
    windBands: [{ altitudeM: 0, speedKts: windKts, directionFromDeg: 0 }], // wind from due north -> drifts south
    timestepS: 0.02,
  });

  const still = runSimulation(mkConfig(0));
  const wind10 = runSimulation(mkConfig(10));
  const wind20 = runSimulation(mkConfig(20));

  const finalNorth = (r: ReturnType<typeof runSimulation>) => r.timeSeries[r.timeSeries.length - 1].yNorthM;

  check("no drift with zero wind", Math.abs(finalNorth(still)) < 1e-6);
  check("wind from due north drifts vehicle south (negative north)", finalNorth(wind10) < -1);
  check(
    "doubling wind speed roughly doubles drift (linear response)",
    approx(finalNorth(wind20), finalNorth(wind10) * 2, 0.1),
    `10kt drift ${finalNorth(wind10).toFixed(1)}m, 20kt drift ${finalNorth(wind20).toFixed(1)}m`
  );

  // Apogee altitude (vertical motion) must be unaffected by wind, since the
  // drift term is horizontal-only - this is also what makes the Section 5.1
  // pre-pass valid without knowing wind in advance.
  check("apogee altitude unaffected by wind", approx(wind20.apogeeAltitudeM, still.apogeeAltitudeM, 0.001));
}

// ---------------------------------------------------------------------------
// Case 5: descent option B (dual-deploy) - drogue phase must be higher-
// drag-appropriate (slower descent rate is not guaranteed pointwise, but
// the phase transition at the specified main-deploy altitude must occur,
// and the phase sequence must be exactly DROGUE -> MAIN).
// ---------------------------------------------------------------------------
{
  console.log("\nCase 5: dual-deploy phase transition at the specified altitude");

  const mainDeployAltitudeM = 300;
  const config: SimConfig = {
    vehicle: {
      wetMassKg: 20,
      dryMassKg: 18,
      totalImpulseNs: 5000,
      burnTimeS: 3,
      referenceDiameterM: 0.15,
      dragCoefficient: 0.5,
      railAngleDeg: 0,
      launchAzimuthDeg: 0,
    },
    descent: { kind: "B", drogueCd: 1.2, drogueArea: 0.2, mainDeployAltitudeM, mainCd: 1.5, mainArea: 2.5 },
    atmosphere: { surfaceTempK: STANDARD_SURFACE_TEMP_K, surfacePressurePa: STANDARD_SURFACE_PRESSURE_PA, siteElevationM: 0 },
    windBands: [{ altitudeM: 0, speedKts: 0, directionFromDeg: 0 }],
    timestepS: 0.02,
  };

  const result = runSimulation(config);
  const mainDeployEvent = result.events.find((e) => e.name === "MAIN_DEPLOY");
  const drogueDeployEvent = result.events.find((e) => e.name === "DROGUE_DEPLOY");

  check("DROGUE_DEPLOY event present at apogee", !!drogueDeployEvent);
  check(
    "MAIN_DEPLOY event occurs at the specified deploy altitude",
    !!mainDeployEvent && approx(mainDeployEvent.altitudeM, mainDeployAltitudeM, 0.05),
    mainDeployEvent ? `got ${mainDeployEvent.altitudeM.toFixed(1)}m, expected ~${mainDeployAltitudeM}m` : "missing"
  );

  const phasesInOrder = Array.from(new Set(result.timeSeries.map((p) => p.phase)));
  check(
    "phase sequence is POWERED_ASCENT, UNPOWERED_ASCENT, DESCENT_DROGUE, DESCENT_MAIN",
    JSON.stringify(phasesInOrder) === JSON.stringify(["POWERED_ASCENT", "UNPOWERED_ASCENT", "DESCENT_DROGUE", "DESCENT_MAIN"]),
    JSON.stringify(phasesInOrder)
  );
}

// ---------------------------------------------------------------------------
// Case 6: pre-pass apogee estimate must closely match the full-resolution
// run's apogee (Section 5.1's stated purpose - resolving wind bands before
// the full run), confirming the coarser-timestep pre-pass is trustworthy.
// ---------------------------------------------------------------------------
{
  console.log("\nCase 6: pre-pass apogee estimate matches full-resolution run");

  const shared = {
    vehicle: {
      wetMassKg: 22,
      dryMassKg: 16,
      totalImpulseNs: 7000,
      burnTimeS: 3.5,
      referenceDiameterM: 0.16,
      dragCoefficient: 0.5,
      railAngleDeg: 5,
      launchAzimuthDeg: 90,
    },
    descent: { kind: "D" as const },
    atmosphere: { surfaceTempK: STANDARD_SURFACE_TEMP_K, surfacePressurePa: STANDARD_SURFACE_PRESSURE_PA, siteElevationM: 200 },
  };

  const { apogeeAltitudeM: prePass } = estimateApogee(shared, 0.1);
  const full = runSimulation({ ...shared, windBands: [{ altitudeM: 0, speedKts: 0, directionFromDeg: 0 }], timestepS: 0.02 });

  check(
    "pre-pass apogee within 2% of full-resolution apogee",
    approx(prePass, full.apogeeAltitudeM, 0.02),
    `pre-pass ${prePass.toFixed(1)}m vs full ${full.apogeeAltitudeM.toFixed(1)}m`
  );
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
