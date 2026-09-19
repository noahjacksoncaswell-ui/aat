-- CreateEnum
CREATE TYPE "TCountStatus" AS ENUM ('PENDING', 'COUNTING', 'HOLDING', 'STOPPED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "HoldType" AS ENUM ('PROGRAMMED', 'UNSCHEDULED');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'DURATION_ELAPSED', 'RELEASED');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'IN_DEVELOPMENT', 'RETIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MissionHistoryEventType" ADD VALUE 'LOT_SUBMITTED';
ALTER TYPE "MissionHistoryEventType" ADD VALUE 'LOT_REVISED';
ALTER TYPE "MissionHistoryEventType" ADD VALUE 'HOLD_CALLED';
ALTER TYPE "MissionHistoryEventType" ADD VALUE 'HOLD_RELEASED';
ALTER TYPE "MissionHistoryEventType" ADD VALUE 'RECYCLED';
ALTER TYPE "MissionHistoryEventType" ADD VALUE 'LIFTOFF_MARKED';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "holdOffsetSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "liftoffActualTime" TIMESTAMP(3),
ADD COLUMN     "lot" TIMESTAMP(3),
ADD COLUMN     "lotMeteorologicalOutlookNotes" TEXT,
ADD COLUMN     "lotRangeAvailabilityNotes" TEXT,
ADD COLUMN     "lotSafetyRegulatoryNotes" TEXT,
ADD COLUMN     "lotScheduleConstraintsNotes" TEXT,
ADD COLUMN     "lotSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "lotVehicleReadinessNotes" TEXT,
ADD COLUMN     "lwccLogClearedAt" TIMESTAMP(3),
ADD COLUMN     "tCountStatus" "TCountStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "MissionDisposition" ADD COLUMN     "actualTotalImpulseNs" DOUBLE PRECISION,
ADD COLUMN     "anomalyReferenceNote" TEXT,
ADD COLUMN     "anomalySummary" TEXT,
ADD COLUMN     "apogeeAltitudeAglMeters" DOUBLE PRECISION,
ADD COLUMN     "apogeeAltitudeMslMeters" DOUBLE PRECISION,
ADD COLUMN     "maxAccelerationG" DOUBLE PRECISION,
ADD COLUMN     "maxVelocityMs" DOUBLE PRECISION,
ADD COLUMN     "missionNotes" TEXT,
ADD COLUMN     "recoveryLocationLat" DOUBLE PRECISION,
ADD COLUMN     "recoveryLocationLon" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "MissionMilestone" ADD COLUMN     "phase" TEXT,
ADD COLUMN     "responsibleStation" TEXT;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "artccFacilityName" TEXT,
ADD COLUMN     "artccPhone" TEXT,
ADD COLUMN     "traconFacilityName" TEXT,
ADD COLUMN     "traconPhone" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "avgThrustN" DOUBLE PRECISION,
ADD COLUMN     "avionicsRedundancy" TEXT,
ADD COLUMN     "burnTimeSeconds" DOUBLE PRECISION,
ADD COLUMN     "configurationNotes" TEXT,
ADD COLUMN     "deploymentMethod" TEXT,
ADD COLUMN     "designator" TEXT,
ADD COLUMN     "diameterIn" DOUBLE PRECISION,
ADD COLUMN     "drogueChuteSpec" TEXT,
ADD COLUMN     "dryMassKg" DOUBLE PRECISION,
ADD COLUMN     "ejectionChargeConfig" TEXT,
ADD COLUMN     "finSpanIn" DOUBLE PRECISION,
ADD COLUMN     "flightComputer" TEXT,
ADD COLUMN     "gpsTracking" TEXT,
ADD COLUMN     "mainChuteSpec" TEXT,
ADD COLUMN     "massFraction" DOUBLE PRECISION,
ADD COLUMN     "maxThrustN" DOUBLE PRECISION,
ADD COLUMN     "motorManufacturer" TEXT,
ADD COLUMN     "motorType" TEXT,
ADD COLUMN     "predictedApogeeM" DOUBLE PRECISION,
ADD COLUMN     "predictedMaxQPsf" DOUBLE PRECISION,
ADD COLUMN     "predictedMaxVelocityMach" DOUBLE PRECISION,
ADD COLUMN     "program" TEXT,
ADD COLUMN     "propellantType" TEXT,
ADD COLUMN     "specificImpulseS" DOUBLE PRECISION,
ADD COLUMN     "stageConfiguration" TEXT,
ADD COLUMN     "status" "VehicleStatus" NOT NULL DEFAULT 'IN_DEVELOPMENT',
ADD COLUMN     "telemetrySystem" TEXT,
ADD COLUMN     "totalImpulseNs" DOUBLE PRECISION,
ADD COLUMN     "totalLengthIn" DOUBLE PRECISION,
ADD COLUMN     "vehicleClass" TEXT,
ADD COLUMN     "wetMassKg" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "WeatherSample" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windSpeedKts" DOUBLE PRECISION,
    "windGustKts" DOUBLE PRECISION,
    "temperatureC" DOUBLE PRECISION,
    "visibilityMi" DOUBLE PRECISION,
    "precipitationProbabilityPct" DOUBLE PRECISION,

    CONSTRAINT "WeatherSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionHold" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "type" "HoldType" NOT NULL,
    "holdMarkSeconds" INTEGER NOT NULL,
    "estimatedDurationSeconds" INTEGER,
    "status" "HoldStatus" NOT NULL DEFAULT 'SCHEDULED',
    "reason" TEXT,
    "actualStartedAt" TIMESTAMP(3),
    "actualEndedAt" TIMESTAMP(3),
    "actualDurationSeconds" INTEGER,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionDispositionAddendum" (
    "id" TEXT NOT NULL,
    "dispositionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" TEXT NOT NULL,

    CONSTRAINT "MissionDispositionAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LwccReport" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "requirementNo" INTEGER NOT NULL,
    "reportedById" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,
    "notes" TEXT,

    CONSTRAINT "LwccReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LwccHold" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "requirementNo" INTEGER NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationSeconds" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LwccHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LwccOverride" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "requirementNo" INTEGER NOT NULL,
    "justification" TEXT NOT NULL,
    "overriddenById" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LwccOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LwccLogEntry" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "requirementNo" INTEGER,
    "actorId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "details" JSONB,

    CONSTRAINT "LwccLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeatherSample_siteId_capturedAt_idx" ON "WeatherSample"("siteId", "capturedAt");

-- CreateIndex
CREATE INDEX "MissionHold_missionId_idx" ON "MissionHold"("missionId");

-- CreateIndex
CREATE INDEX "MissionDispositionAddendum_dispositionId_idx" ON "MissionDispositionAddendum"("dispositionId");

-- CreateIndex
CREATE INDEX "LwccReport_missionId_requirementNo_idx" ON "LwccReport"("missionId", "requirementNo");

-- CreateIndex
CREATE INDEX "LwccHold_missionId_requirementNo_active_idx" ON "LwccHold"("missionId", "requirementNo", "active");

-- CreateIndex
CREATE INDEX "LwccOverride_missionId_requirementNo_active_idx" ON "LwccOverride"("missionId", "requirementNo", "active");

-- CreateIndex
CREATE INDEX "LwccLogEntry_missionId_idx" ON "LwccLogEntry"("missionId");

-- CreateIndex
CREATE INDEX "Document_vehicleId_idx" ON "Document"("vehicleId");

-- AddForeignKey
ALTER TABLE "WeatherSample" ADD CONSTRAINT "WeatherSample_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionHold" ADD CONSTRAINT "MissionHold_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionHold" ADD CONSTRAINT "MissionHold_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionDispositionAddendum" ADD CONSTRAINT "MissionDispositionAddendum_dispositionId_fkey" FOREIGN KEY ("dispositionId") REFERENCES "MissionDisposition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionDispositionAddendum" ADD CONSTRAINT "MissionDispositionAddendum_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LwccReport" ADD CONSTRAINT "LwccReport_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LwccReport" ADD CONSTRAINT "LwccReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LwccHold" ADD CONSTRAINT "LwccHold_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LwccOverride" ADD CONSTRAINT "LwccOverride_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LwccOverride" ADD CONSTRAINT "LwccOverride_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LwccLogEntry" ADD CONSTRAINT "LwccLogEntry_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LwccLogEntry" ADD CONSTRAINT "LwccLogEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
