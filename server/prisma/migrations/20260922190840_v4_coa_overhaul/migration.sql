/*
  Warnings:

  - Added the required column `authorizedOperationRadiusNm` to the `COA` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dailyWindowClose` to the `COA` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dailyWindowOpen` to the `COA` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fixRadialDistance` to the `COA` table without a default value. This is not possible if the table is not empty.
  - Added the required column `issuedTo` to the `COA` table without a default value. This is not possible if the table is not empty.
  - Made the column `authorizedActivity` on table `COA` required. This step will fail if there are existing NULL values in that column.
  - Made the column `altitudeLimits` on table `COA` required. This step will fail if there are existing NULL values in that column.
  - Made the column `conditions` on table `COA` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "COA" ADD COLUMN     "authorizedOperationRadiusNm" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "dailyWindowClose" TEXT NOT NULL,
ADD COLUMN     "dailyWindowOpen" TEXT NOT NULL,
ADD COLUMN     "fixRadialDistance" TEXT NOT NULL,
ADD COLUMN     "issuedTo" TEXT NOT NULL,
ALTER COLUMN "authorizedActivity" SET NOT NULL,
ALTER COLUMN "altitudeLimits" SET NOT NULL,
ALTER COLUMN "conditions" SET NOT NULL;
