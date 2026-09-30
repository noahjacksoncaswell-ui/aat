-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MissionHistoryEventType" ADD VALUE 'TERMINAL_COUNT_ARMED';
ALTER TYPE "MissionHistoryEventType" ADD VALUE 'TERMINAL_COUNT_REVOKED';
ALTER TYPE "MissionHistoryEventType" ADD VALUE 'TERMINAL_COUNT_AUTO_HOLD';
ALTER TYPE "MissionHistoryEventType" ADD VALUE 'XMIT_CCS_TO_VFS';

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "terminalCountArmedAt" TIMESTAMP(3),
ADD COLUMN     "terminalCountArmedById" TEXT,
ADD COLUMN     "terminalCountXmitAt" TIMESTAMP(3),
ADD COLUMN     "terminalCountXmitById" TEXT;

-- AlterTable
ALTER TABLE "MissionHold" ADD COLUMN     "isTerminalCountAutoHold" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_terminalCountArmedById_fkey" FOREIGN KEY ("terminalCountArmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_terminalCountXmitById_fkey" FOREIGN KEY ("terminalCountXmitById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data migration: v9.3 Section 5 - rename VSE Ground Systems poll item
-- key from VSE_LCS to VSE_VFS (label/shortLabel change alone would
-- orphan existing rows under the old key, since itemKey is a plain
-- string with no DB-level enum).
UPDATE "PollItem" SET "itemKey" = 'VSE_VFS' WHERE "itemKey" = 'VSE_LCS';
UPDATE "PollAuditEntry" SET "itemKey" = 'VSE_VFS' WHERE "itemKey" = 'VSE_LCS';
