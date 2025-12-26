-- DropForeignKey
ALTER TABLE "verifications" DROP CONSTRAINT "verifications_subscriptionId_fkey";

-- AlterTable
ALTER TABLE "verifications" ALTER COLUMN "subscriptionId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
