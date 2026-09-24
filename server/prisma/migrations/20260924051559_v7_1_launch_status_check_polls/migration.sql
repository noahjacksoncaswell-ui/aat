-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "launchCountTimeConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "launchCountTimeConfirmedById" TEXT,
ADD COLUMN     "launchCountTimeConfirmedValue" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PollItem" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollAuditEntry" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT NOT NULL,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "actorId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PollItem_missionId_idx" ON "PollItem"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "PollItem_missionId_itemKey_key" ON "PollItem"("missionId", "itemKey");

-- CreateIndex
CREATE INDEX "PollAuditEntry_missionId_idx" ON "PollAuditEntry"("missionId");

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_launchCountTimeConfirmedById_fkey" FOREIGN KEY ("launchCountTimeConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollItem" ADD CONSTRAINT "PollItem_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollItem" ADD CONSTRAINT "PollItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAuditEntry" ADD CONSTRAINT "PollAuditEntry_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollAuditEntry" ADD CONSTRAINT "PollAuditEntry_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
