import { PrismaClient, Role, SiteStatus, SiteType, MissionStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { STANDARD_GO_NO_GO_STATIONS } from "../src/services/missionWorkflow";
import { COUNTDOWN_MILESTONE_SEQUENCE } from "../src/services/countdownSequence";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("AAT-LOD-2026!", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@aat-aerospace.example" },
    update: {},
    create: {
      name: "J. Reyes",
      email: "admin@aat-aerospace.example",
      passwordHash,
      role: Role.ADMIN,
    },
  });

  const launchDirector = await prisma.user.upsert({
    where: { email: "ld@aat-aerospace.example" },
    update: {},
    create: {
      name: "M. Okafor",
      email: "ld@aat-aerospace.example",
      passwordHash,
      role: Role.LAUNCH_DIRECTOR,
    },
  });

  const operator = await prisma.user.upsert({
    where: { email: "ops@aat-aerospace.example" },
    update: {},
    create: {
      name: "S. Whitfield",
      email: "ops@aat-aerospace.example",
      passwordHash,
      role: Role.OPERATOR,
    },
  });

  const viewer = await prisma.user.upsert({
    where: { email: "viewer@aat-aerospace.example" },
    update: {},
    create: {
      name: "T. Caswell",
      email: "viewer@aat-aerospace.example",
      passwordHash,
      role: Role.VIEWER,
    },
  });

  const site = await prisma.site.upsert({
    where: { designator: "AAT-LC1" },
    update: {},
    create: {
      name: "AAT Launch Complex 1",
      designator: "AAT-LC1",
      lat: 34.1608, // Cartersville, GA area - stand-in coordinates
      lon: -84.7999,
      elevationMeters: 210,
      status: SiteStatus.ACTIVE,
      type: SiteType.FIXED_PAD,
      ownershipNotes: "AAT-owned parcel, fee simple.",
      jurisdictionNotes: "Bartow County, GA. FAA ATL ARTCC coordination.",
      nearestPopulationCenters: "Cartersville, GA (8 mi)",
      nearestWaterBodies: "Lake Allatoona (6 mi)",
      terrainType: "Rolling piedmont, mixed forest/cleared range",
      countryCode: "US",
      traconFacilityName: "Atlanta TRACON (A80)",
      traconPhone: "(770) 210-1000",
      artccFacilityName: "Atlanta ARTCC (ZTL)",
      artccPhone: "(770) 210-2000",
    },
  });

  const site2 = await prisma.site.upsert({
    where: { designator: "AAT-LC2" },
    update: {},
    create: {
      name: "AAT Mobile TEL Site - Black Rock",
      designator: "AAT-LC2",
      lat: 33.7756,
      lon: -84.3963,
      elevationMeters: 320,
      status: SiteStatus.STANDBY,
      type: SiteType.MOBILE_TEL,
      countryCode: "US",
    },
  });

  const vehicle = await prisma.vehicle.upsert({
    where: { id: "seed-vehicle-tenacity" },
    update: {},
    create: {
      id: "seed-vehicle-tenacity",
      name: "Tenacity",
      type: "Sounding Rocket",
      designator: "TNC-01",
      vehicleClass: "Class 2 High Power",
      program: "Tenacity Flight Test Program",
      status: "ACTIVE",
      totalLengthIn: 126,
      diameterIn: 6.17,
      finSpanIn: 22,
      wetMassKg: 68.5,
      dryMassKg: 52.1,
      massFraction: 0.24,
      motorType: "L1520",
      motorManufacturer: "Cesaroni",
      propellantType: "APCP",
      totalImpulseNs: 9850,
      burnTimeSeconds: 3.4,
      avgThrustN: 1520,
      maxThrustN: 1890,
      specificImpulseS: 235,
      stageConfiguration: "Single stage",
      drogueChuteSpec: '24" drogue, deployed at apogee',
      mainChuteSpec: '96" main, deployed at 700 ft AGL',
      deploymentMethod: "Dual-deploy, redundant altimeters",
      ejectionChargeConfig: "Redundant black powder charges, primary + backup altimeter",
      flightComputer: "MissileWorks RRC3+ (dual redundant)",
      telemetrySystem: "L-band downlink, 10 Hz",
      gpsTracking: "u-blox M8, GPS/GLONASS",
      avionicsRedundancy: "Dual independent altimeter/GPS chains",
      predictedApogeeM: 9100,
      predictedMaxVelocityMach: 1.4,
      predictedMaxQPsf: 620,
      windMaxKts: 20,
      ceilingMinFt: 3000,
      lightningRadiusMi: 10,
      maxPrecipProbability: 40,
      notes: "Single-stage solid motor sounding rocket, flight test vehicle.",
    },
  });

  const template = await prisma.milestoneTemplate.create({
    data: {
      vehicleId: vehicle.id,
      name: "Tenacity Standard Countdown",
      items: {
        create: [
          { label: "Vehicle Rollout", tMinusSeconds: 24 * 3600, sortOrder: 0 },
          { label: "Range Safety Briefing", tMinusSeconds: 6 * 3600, sortOrder: 1 },
          { label: "Propellant Load Begins", tMinusSeconds: 4 * 3600, sortOrder: 2 },
          { label: "Final Poll", tMinusSeconds: 15 * 60, sortOrder: 3 },
          { label: "Terminal Count", tMinusSeconds: 60, sortOrder: 4 },
          { label: "Ignition", tMinusSeconds: 10, sortOrder: 5 },
        ],
      },
    },
  });

  const now = new Date();
  const inFiveDays = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const inSixDays = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const mission = await prisma.mission.upsert({
    where: { designator: "AAT-M001" },
    update: {},
    create: {
      name: "Tenacity Flight Test 1",
      designator: "AAT-M001",
      vehicleId: vehicle.id,
      siteId: site.id,
      status: MissionStatus.TARGETED,
      payloadDescription: "Avionics validation payload, no live ordnance.",
      launchPeriodEntries: {
        create: [
          {
            date: new Date(Date.UTC(inFiveDays.getUTCFullYear(), inFiveDays.getUTCMonth(), inFiveDays.getUTCDate())),
            windowOpen: new Date(Date.UTC(inFiveDays.getUTCFullYear(), inFiveDays.getUTCMonth(), inFiveDays.getUTCDate(), 13, 0)),
            windowClose: new Date(Date.UTC(inFiveDays.getUTCFullYear(), inFiveDays.getUTCMonth(), inFiveDays.getUTCDate(), 17, 0)),
            isTargeted: true,
          },
          {
            date: new Date(Date.UTC(inSixDays.getUTCFullYear(), inSixDays.getUTCMonth(), inSixDays.getUTCDate())),
            windowOpen: new Date(Date.UTC(inSixDays.getUTCFullYear(), inSixDays.getUTCMonth(), inSixDays.getUTCDate(), 13, 0)),
            windowClose: new Date(Date.UTC(inSixDays.getUTCFullYear(), inSixDays.getUTCMonth(), inSixDays.getUTCDate(), 17, 0)),
          },
          {
            date: new Date(Date.UTC(inSevenDays.getUTCFullYear(), inSevenDays.getUTCMonth(), inSevenDays.getUTCDate())),
            windowOpen: new Date(Date.UTC(inSevenDays.getUTCFullYear(), inSevenDays.getUTCMonth(), inSevenDays.getUTCDate(), 13, 0)),
            windowClose: new Date(Date.UTC(inSevenDays.getUTCFullYear(), inSevenDays.getUTCMonth(), inSevenDays.getUTCDate(), 17, 0)),
          },
        ],
      },
      goNoGoPolls: {
        create: STANDARD_GO_NO_GO_STATIONS.map((stationName) => ({
          stationName,
        })),
      },
      milestones: {
        create: COUNTDOWN_MILESTONE_SEQUENCE,
      },
      launchDayNotifications: {
        create: [{ notificationType: "T_MINUS_60" }, { notificationType: "T_MINUS_15" }, { notificationType: "TERMINATION" }],
      },
      assignedUsers: {
        create: [
          { userId: launchDirector.id, role: "Launch Director" },
          { userId: operator.id, role: "Flight Dynamics Officer" },
        ],
      },
    },
  });

  await prisma.cOA.upsert({
    where: { id: "seed-coa-lc1" },
    update: {},
    create: {
      id: "seed-coa-lc1",
      siteId: site.id,
      coaNumber: "2026-ATL-0142",
      issuingFacility: "FAA Atlanta ARTCC",
      effectiveDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      expirationDate: new Date(now.getTime() + 335 * 24 * 60 * 60 * 1000),
      authorizedActivity: "Sounding rocket launch operations, unguided, to 30,000 ft AGL",
      altitudeLimits: "Surface to FL300 within a 3nm radius of AAT-LC1",
      conditions: "NOTAM required 7 days prior; T-60/T-15/termination calls to ATL ARTCC mandatory.",
    },
  });

  console.log("Seed complete.");
  console.log("Login credentials (all users share the seed password AAT-LOD-2026!):");
  console.log(`  Admin:            ${admin.email}`);
  console.log(`  Launch Director:  ${launchDirector.email}`);
  console.log(`  Operator:         ${operator.email}`);
  console.log(`  Viewer:           ${viewer.email}`);
  console.log(`Mission ${mission.designator} targeted, template "${template.name}" available for ${vehicle.name}.`);
  console.log(`Second site on file: ${site2.designator}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
