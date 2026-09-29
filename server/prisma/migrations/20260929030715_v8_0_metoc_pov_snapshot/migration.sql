-- CreateTable
CREATE TABLE "MetocPovSnapshot" (
    "id" TEXT NOT NULL,
    "siteId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "forecastDate" TIMESTAMP(3) NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "povPercent" INTEGER NOT NULL,
    "primaryConcerns" TEXT[],

    CONSTRAINT "MetocPovSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetocPovSnapshot_siteId_forecastDate_idx" ON "MetocPovSnapshot"("siteId", "forecastDate");

-- CreateIndex
CREATE INDEX "MetocPovSnapshot_lat_lon_forecastDate_idx" ON "MetocPovSnapshot"("lat", "lon", "forecastDate");

-- AddForeignKey
ALTER TABLE "MetocPovSnapshot" ADD CONSTRAINT "MetocPovSnapshot_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
