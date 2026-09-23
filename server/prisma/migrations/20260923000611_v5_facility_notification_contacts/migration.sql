-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "otherFacilityName" TEXT,
ADD COLUMN     "otherFacilityNotApplicable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "otherFacilityPhone" TEXT;
