-- CreateEnum
CREATE TYPE "MissionRole" AS ENUM ('LD', 'RC', 'LWO', 'VSE', 'OPS_SUPPORT');

-- CreateEnum
CREATE TYPE "QualificationRole" AS ENUM ('RC', 'LWO', 'VSE');

-- CreateTable
CREATE TABLE "MissionPersonnelAssignment" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MissionRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT NOT NULL,
    "attestationSignatureName" TEXT,
    "attestationSignatureRole" TEXT,
    "attestationSignedAt" TIMESTAMP(3),
    "onStationAt" TIMESTAMP(3),
    "offStationOverride" BOOLEAN NOT NULL DEFAULT false,
    "offStationOverrideReason" TEXT,
    "offStationOverrideById" TEXT,
    "offStationOverrideAt" TIMESTAMP(3),

    CONSTRAINT "MissionPersonnelAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionPersonnelAuditEntry" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "role" "MissionRole" NOT NULL,
    "action" TEXT NOT NULL,
    "previousUserId" TEXT,
    "newUserId" TEXT,
    "notes" TEXT,
    "actorId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionPersonnelAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonnelQualification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "QualificationRole" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "PersonnelQualification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MissionPersonnelAssignment_missionId_idx" ON "MissionPersonnelAssignment"("missionId");

-- CreateIndex
CREATE INDEX "MissionPersonnelAssignment_userId_idx" ON "MissionPersonnelAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MissionPersonnelAssignment_missionId_userId_key" ON "MissionPersonnelAssignment"("missionId", "userId");

-- CreateIndex
CREATE INDEX "MissionPersonnelAuditEntry_missionId_idx" ON "MissionPersonnelAuditEntry"("missionId");

-- CreateIndex
CREATE INDEX "PersonnelQualification_userId_idx" ON "PersonnelQualification"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonnelQualification_userId_role_key" ON "PersonnelQualification"("userId", "role");

-- AddForeignKey
ALTER TABLE "MissionPersonnelAssignment" ADD CONSTRAINT "MissionPersonnelAssignment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionPersonnelAssignment" ADD CONSTRAINT "MissionPersonnelAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionPersonnelAssignment" ADD CONSTRAINT "MissionPersonnelAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionPersonnelAssignment" ADD CONSTRAINT "MissionPersonnelAssignment_offStationOverrideById_fkey" FOREIGN KEY ("offStationOverrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionPersonnelAuditEntry" ADD CONSTRAINT "MissionPersonnelAuditEntry_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionPersonnelAuditEntry" ADD CONSTRAINT "MissionPersonnelAuditEntry_previousUserId_fkey" FOREIGN KEY ("previousUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionPersonnelAuditEntry" ADD CONSTRAINT "MissionPersonnelAuditEntry_newUserId_fkey" FOREIGN KEY ("newUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionPersonnelAuditEntry" ADD CONSTRAINT "MissionPersonnelAuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelQualification" ADD CONSTRAINT "PersonnelQualification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelQualification" ADD CONSTRAINT "PersonnelQualification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
