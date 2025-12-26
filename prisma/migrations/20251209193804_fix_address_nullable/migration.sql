/*
  Warnings:

  - You are about to drop the column `address` on the `locations` table. All the data in the column will be lost.
  - You are about to drop the column `addressLine1` on the `partners` table. All the data in the column will be lost.
  - You are about to drop the column `addressLine2` on the `partners` table. All the data in the column will be lost.
  - You are about to drop the column `businessAddress` on the `partners` table. All the data in the column will be lost.
  - You are about to drop the column `city` on the `partners` table. All the data in the column will be lost.
  - You are about to drop the column `country` on the `partners` table. All the data in the column will be lost.
  - You are about to drop the column `county` on the `partners` table. All the data in the column will be lost.
  - You are about to drop the column `postcode` on the `partners` table. All the data in the column will be lost.
  - Made the column `country` on table `locations` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "partners_postcode_idx";

-- AlterTable
ALTER TABLE "locations" DROP COLUMN "address",
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "country" SET NOT NULL;

-- AlterTable
ALTER TABLE "partners" DROP COLUMN "addressLine1",
DROP COLUMN "addressLine2",
DROP COLUMN "businessAddress",
DROP COLUMN "city",
DROP COLUMN "country",
DROP COLUMN "county",
DROP COLUMN "postcode",
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "locations_partnerId_idx" ON "locations"("partnerId");

-- CreateIndex
CREATE INDEX "locations_isPrimary_idx" ON "locations"("isPrimary");
