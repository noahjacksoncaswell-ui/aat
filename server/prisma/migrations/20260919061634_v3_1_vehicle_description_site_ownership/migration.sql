-- CreateEnum
CREATE TYPE "SiteOwnership" AS ENUM ('COMPANY_OWNED', 'THIRD_PARTY_LEASED');

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "ownership" "SiteOwnership" NOT NULL DEFAULT 'COMPANY_OWNED';

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "description" TEXT;
