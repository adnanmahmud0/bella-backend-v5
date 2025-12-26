/*
  Warnings:

  - You are about to drop the column `bankAccountName` on the `partners` table. All the data in the column will be lost.
  - You are about to drop the column `bankAccountNumber` on the `partners` table. All the data in the column will be lost.
  - You are about to drop the column `bankIban` on the `partners` table. All the data in the column will be lost.
  - You are about to drop the column `bankSortCode` on the `partners` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "partners" DROP COLUMN "bankAccountName",
DROP COLUMN "bankAccountNumber",
DROP COLUMN "bankIban",
DROP COLUMN "bankSortCode",
ADD COLUMN     "fcmToken" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "fcmToken" TEXT;

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);
