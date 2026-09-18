-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'LAUNCH_DIRECTOR', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('ACTIVE', 'STANDBY', 'UNDER_CONSTRUCTION', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "SiteType" AS ENUM ('FIXED_PAD', 'MOBILE_TEL', 'MARINE_PLATFORM', 'OTHER');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('PENDING_WINDOW', 'TARGETED', 'HOLD', 'SCRUBBED', 'POSTPONED', 'CANCELLED', 'SUCCESSFUL');

-- CreateEnum
CREATE TYPE "MissionHistoryEventType" AS ENUM ('TARGETED', 'POSTPONED', 'CANCELLED', 'SCRUBBED', 'SUCCESSFUL', 'NOTE');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'COMPLETE', 'HELD');

-- CreateEnum
CREATE TYPE "GoNoGoStatus" AS ENUM ('UNPOLLED', 'GO', 'NO_GO', 'HOLD');

-- CreateEnum
CREATE TYPE "CoaStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'PENDING');

-- CreateEnum
CREATE TYPE "NotamFilingStatus" AS ENUM ('NOT_FILED', 'FILED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('T_MINUS_60', 'T_MINUS_15', 'TERMINATION');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSiteAssignment" (
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,

    CONSTRAINT "UserSiteAssignment_pkey" PRIMARY KEY ("userId","siteId")
);

-- CreateTable
CREATE TABLE "UserMissionAssignment" (
    "userId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "role" TEXT,

    CONSTRAINT "UserMissionAssignment_pkey" PRIMARY KEY ("userId","missionId")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designator" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "elevationMeters" DOUBLE PRECISION,
    "status" "SiteStatus" NOT NULL DEFAULT 'STANDBY',
    "type" "SiteType" NOT NULL DEFAULT 'FIXED_PAD',
    "ownershipNotes" TEXT,
    "jurisdictionNotes" TEXT,
    "nearestPopulationCenters" TEXT,
    "nearestWaterBodies" TEXT,
    "terrainType" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'US',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePhoto" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "windMaxKts" DOUBLE PRECISION,
    "ceilingMinFt" DOUBLE PRECISION,
    "lightningRadiusMi" DOUBLE PRECISION,
    "maxPrecipProbability" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneTemplate" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MilestoneTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneTemplateItem" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tMinusSeconds" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MilestoneTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designator" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "MissionStatus" NOT NULL DEFAULT 'PENDING_WINDOW',
    "payloadDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchPeriodEntry" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "windowOpen" TIMESTAMP(3) NOT NULL,
    "windowClose" TIMESTAMP(3) NOT NULL,
    "isTargeted" BOOLEAN NOT NULL DEFAULT false,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaunchPeriodEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionHistoryEvent" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "eventType" "MissionHistoryEventType" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "notes" TEXT,
    "relatedLaunchPeriodEntryId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "MissionHistoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionDisposition" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actualLiftoffTime" TIMESTAMP(3),
    "apogeeAltitudeMeters" DOUBLE PRECISION,
    "flightDurationSeconds" INTEGER,
    "vehiclePerformanceNotes" TEXT,
    "payloadOutcome" TEXT,
    "recoveryStatus" TEXT,
    "anomaliesNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionDisposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionMilestone" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tMinusSeconds" INTEGER NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'UPCOMING',
    "actualTime" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MissionMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoNoGoPoll" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "status" "GoNoGoStatus" NOT NULL DEFAULT 'UNPOLLED',
    "updatedById" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoNoGoPoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionLogEntry" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "text" TEXT NOT NULL,

    CONSTRAINT "MissionLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "COA" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "coaNumber" TEXT NOT NULL,
    "issuingFacility" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "authorizedActivity" TEXT,
    "altitudeLimits" TEXT,
    "conditions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "COA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NOTAMFiling" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "filedDate" TIMESTAMP(3),
    "leidosConfirmationNumber" TEXT,
    "notamWindowOpen" TIMESTAMP(3),
    "notamWindowClose" TIMESTAMP(3),
    "filedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NOTAMFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchDayNotification" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "notificationType" "NotificationType" NOT NULL,
    "satisfied" BOOLEAN NOT NULL DEFAULT false,
    "notApplicable" BOOLEAN NOT NULL DEFAULT false,
    "contactedFacility" TEXT,
    "contactedById" TEXT,
    "timestamp" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaunchDayNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "siteId" TEXT,
    "missionId" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAuditEntry" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "DocumentAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLogEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AuditLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_designator_key" ON "Site"("designator");

-- CreateIndex
CREATE INDEX "Site_status_idx" ON "Site"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Mission_designator_key" ON "Mission"("designator");

-- CreateIndex
CREATE INDEX "Mission_status_idx" ON "Mission"("status");

-- CreateIndex
CREATE INDEX "Mission_siteId_idx" ON "Mission"("siteId");

-- CreateIndex
CREATE INDEX "LaunchPeriodEntry_missionId_idx" ON "LaunchPeriodEntry"("missionId");

-- CreateIndex
CREATE INDEX "MissionHistoryEvent_missionId_idx" ON "MissionHistoryEvent"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "MissionDisposition_missionId_key" ON "MissionDisposition"("missionId");

-- CreateIndex
CREATE INDEX "MissionMilestone_missionId_idx" ON "MissionMilestone"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "GoNoGoPoll_missionId_stationName_key" ON "GoNoGoPoll"("missionId", "stationName");

-- CreateIndex
CREATE INDEX "MissionLogEntry_missionId_idx" ON "MissionLogEntry"("missionId");

-- CreateIndex
CREATE INDEX "COA_siteId_idx" ON "COA"("siteId");

-- CreateIndex
CREATE INDEX "NOTAMFiling_missionId_idx" ON "NOTAMFiling"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "LaunchDayNotification_missionId_notificationType_key" ON "LaunchDayNotification"("missionId", "notificationType");

-- CreateIndex
CREATE INDEX "Document_category_idx" ON "Document"("category");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "Document_siteId_idx" ON "Document"("siteId");

-- CreateIndex
CREATE INDEX "Document_missionId_idx" ON "Document"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "DocumentAuditEntry_documentId_idx" ON "DocumentAuditEntry"("documentId");

-- CreateIndex
CREATE INDEX "AuditLogEntry_targetType_targetId_idx" ON "AuditLogEntry"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLogEntry_timestamp_idx" ON "AuditLogEntry"("timestamp");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteAssignment" ADD CONSTRAINT "UserSiteAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteAssignment" ADD CONSTRAINT "UserSiteAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMissionAssignment" ADD CONSTRAINT "UserMissionAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMissionAssignment" ADD CONSTRAINT "UserMissionAssignment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SitePhoto" ADD CONSTRAINT "SitePhoto_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneTemplate" ADD CONSTRAINT "MilestoneTemplate_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneTemplateItem" ADD CONSTRAINT "MilestoneTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MilestoneTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchPeriodEntry" ADD CONSTRAINT "LaunchPeriodEntry_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionHistoryEvent" ADD CONSTRAINT "MissionHistoryEvent_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionHistoryEvent" ADD CONSTRAINT "MissionHistoryEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionHistoryEvent" ADD CONSTRAINT "MissionHistoryEvent_relatedLaunchPeriodEntryId_fkey" FOREIGN KEY ("relatedLaunchPeriodEntryId") REFERENCES "LaunchPeriodEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionDisposition" ADD CONSTRAINT "MissionDisposition_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionMilestone" ADD CONSTRAINT "MissionMilestone_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoNoGoPoll" ADD CONSTRAINT "GoNoGoPoll_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoNoGoPoll" ADD CONSTRAINT "GoNoGoPoll_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionLogEntry" ADD CONSTRAINT "MissionLogEntry_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionLogEntry" ADD CONSTRAINT "MissionLogEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "COA" ADD CONSTRAINT "COA_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NOTAMFiling" ADD CONSTRAINT "NOTAMFiling_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NOTAMFiling" ADD CONSTRAINT "NOTAMFiling_filedById_fkey" FOREIGN KEY ("filedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchDayNotification" ADD CONSTRAINT "LaunchDayNotification_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchDayNotification" ADD CONSTRAINT "LaunchDayNotification_contactedById_fkey" FOREIGN KEY ("contactedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAuditEntry" ADD CONSTRAINT "DocumentAuditEntry_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAuditEntry" ADD CONSTRAINT "DocumentAuditEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLogEntry" ADD CONSTRAINT "AuditLogEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
