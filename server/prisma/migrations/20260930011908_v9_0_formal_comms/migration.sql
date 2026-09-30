-- CreateEnum
CREATE TYPE "CommsRecipient" AS ENUM ('GENERAL', 'LD', 'LWO', 'RC', 'VSE');

-- CreateTable
CREATE TABLE "FormalCommsMessage" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderRole" "MissionRole" NOT NULL,
    "recipient" "CommsRecipient" NOT NULL,
    "actionCode" TEXT NOT NULL,
    "fields" JSONB,
    "detail" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionCode" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormalCommsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormalCommsMessage_missionId_idx" ON "FormalCommsMessage"("missionId");

-- CreateIndex
CREATE INDEX "FormalCommsMessage_missionId_actionCode_resolvedAt_idx" ON "FormalCommsMessage"("missionId", "actionCode", "resolvedAt");

-- AddForeignKey
ALTER TABLE "FormalCommsMessage" ADD CONSTRAINT "FormalCommsMessage_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalCommsMessage" ADD CONSTRAINT "FormalCommsMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormalCommsMessage" ADD CONSTRAINT "FormalCommsMessage_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
