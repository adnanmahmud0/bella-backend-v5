/*
  Warnings:

  - A unique constraint covering the columns `[oneTimePurchaseId]` on the table `qr_codes` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[oneTimePurchaseId]` on the table `verifications` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- AlterTable
ALTER TABLE "qr_codes" ADD COLUMN     "oneTimePurchaseId" INTEGER,
ALTER COLUMN "subscriptionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "verifications" ADD COLUMN     "oneTimePurchaseId" INTEGER;

-- CreateTable
CREATE TABLE "extra_services" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "type" "WashType" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extra_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_purchases" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "stripePaymentIntentId" TEXT,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "usedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "one_time_purchases_stripePaymentIntentId_key" ON "one_time_purchases"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_oneTimePurchaseId_key" ON "qr_codes"("oneTimePurchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "verifications_oneTimePurchaseId_key" ON "verifications"("oneTimePurchaseId");

-- AddForeignKey
ALTER TABLE "one_time_purchases" ADD CONSTRAINT "one_time_purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_purchases" ADD CONSTRAINT "one_time_purchases_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "extra_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_oneTimePurchaseId_fkey" FOREIGN KEY ("oneTimePurchaseId") REFERENCES "one_time_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_oneTimePurchaseId_fkey" FOREIGN KEY ("oneTimePurchaseId") REFERENCES "one_time_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
