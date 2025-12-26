/*
  Warnings:

  - You are about to drop the column `quota` on the `plans` table. All the data in the column will be lost.
  - You are about to drop the column `washesUsed` on the `subscriptions` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "WashType" AS ENUM ('IN_AND_OUT', 'OUTSIDE_ONLY');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'TAXI', 'VAN');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('BASE', 'STANDARD', 'PREMIUM');

-- AlterTable
ALTER TABLE "plans" DROP COLUMN "quota",
ADD COLUMN     "inAndOutPayout" DOUBLE PRECISION,
ADD COLUMN     "inAndOutQuota" INTEGER,
ADD COLUMN     "outsideOnlyPayout" DOUBLE PRECISION,
ADD COLUMN     "outsideOnlyQuota" INTEGER,
ADD COLUMN     "tier" "PlanTier",
ADD COLUMN     "vehicleType" "VehicleType";

-- AlterTable
ALTER TABLE "qr_codes" ADD COLUMN     "washType" "WashType";

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "washesUsed",
ADD COLUMN     "inAndOutWashesUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "outsideOnlyWashesUsed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "verification_codes" ADD COLUMN     "washType" "WashType";

-- AlterTable
ALTER TABLE "verifications" ADD COLUMN     "payoutAmount" DOUBLE PRECISION,
ADD COLUMN     "washType" "WashType";
