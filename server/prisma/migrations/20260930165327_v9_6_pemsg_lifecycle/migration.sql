-- CreateEnum
CREATE TYPE "PemsgLifecycleState" AS ENUM ('PENDING', 'APPROVED', 'ACTIONED', 'DENIED', 'WAIVED');

-- AlterTable
ALTER TABLE "FormalCommsMessage" ADD COLUMN     "lifecycleState" "PemsgLifecycleState";

-- CreateIndex
CREATE INDEX "FormalCommsMessage_missionId_actionCode_lifecycleState_idx" ON "FormalCommsMessage"("missionId", "actionCode", "lifecycleState");

