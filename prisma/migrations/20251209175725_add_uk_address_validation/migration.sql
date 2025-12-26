-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'United Kingdom',
ADD COLUMN     "county" TEXT,
ADD COLUMN     "postcode" TEXT;

-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "addressLine1" TEXT,
ADD COLUMN     "addressLine2" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT DEFAULT 'United Kingdom',
ADD COLUMN     "county" TEXT,
ADD COLUMN     "postcode" TEXT;

-- CreateIndex
CREATE INDEX "locations_postcode_idx" ON "locations"("postcode");

-- CreateIndex
CREATE INDEX "partners_postcode_idx" ON "partners"("postcode");
