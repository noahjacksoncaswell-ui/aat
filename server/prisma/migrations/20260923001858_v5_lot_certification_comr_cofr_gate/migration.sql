/*
  Warnings:

  - You are about to drop the column `lotMeteorologicalOutlookNotes` on the `Mission` table. All the data in the column will be lost.
  - You are about to drop the column `lotRangeAvailabilityNotes` on the `Mission` table. All the data in the column will be lost.
  - You are about to drop the column `lotSafetyRegulatoryNotes` on the `Mission` table. All the data in the column will be lost.
  - You are about to drop the column `lotScheduleConstraintsNotes` on the `Mission` table. All the data in the column will be lost.
  - You are about to drop the column `lotVehicleReadinessNotes` on the `Mission` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "CofrBasis" AS ENUM ('APPROVED_ON_FILE', 'WILL_FILE_WITHIN_24H');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MissionHistoryEventType" ADD VALUE 'COFR_COMPLIANCE_LAPSED';
ALTER TYPE "MissionHistoryEventType" ADD VALUE 'COFR_COMPLIANCE_RESOLVED';

-- AlterTable
ALTER TABLE "Mission" DROP COLUMN "lotMeteorologicalOutlookNotes",
DROP COLUMN "lotRangeAvailabilityNotes",
DROP COLUMN "lotSafetyRegulatoryNotes",
DROP COLUMN "lotScheduleConstraintsNotes",
DROP COLUMN "lotVehicleReadinessNotes";

-- AlterTable
ALTER TABLE "MissionHold" ADD COLUMN     "isCofrComplianceHold" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LotCertification" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "comrDocumentId" TEXT NOT NULL,
    "certifications" JSONB NOT NULL,
    "signatureName" TEXT NOT NULL,
    "signatureRole" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedById" TEXT NOT NULL,
    "cofrBasis" "CofrBasis" NOT NULL,
    "cofrComplianceDeadline" TIMESTAMP(3),
    "cofrGateHoldId" TEXT,
    "cofrGateLapsedAt" TIMESTAMP(3),
    "cofrGateResolvedAt" TIMESTAMP(3),
    "cofrGateResolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotCertification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LotCertification_missionId_idx" ON "LotCertification"("missionId");

-- CreateIndex
CREATE INDEX "LotCertification_comrDocumentId_idx" ON "LotCertification"("comrDocumentId");

-- AddForeignKey
ALTER TABLE "LotCertification" ADD CONSTRAINT "LotCertification_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotCertification" ADD CONSTRAINT "LotCertification_comrDocumentId_fkey" FOREIGN KEY ("comrDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotCertification" ADD CONSTRAINT "LotCertification_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotCertification" ADD CONSTRAINT "LotCertification_cofrGateResolvedById_fkey" FOREIGN KEY ("cofrGateResolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
