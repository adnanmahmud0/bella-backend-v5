-- AlterTable
ALTER TABLE "verification_codes" ADD COLUMN     "oneTimePurchaseId" INTEGER,
ALTER COLUMN "subscriptionId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_oneTimePurchaseId_fkey" FOREIGN KEY ("oneTimePurchaseId") REFERENCES "one_time_purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
