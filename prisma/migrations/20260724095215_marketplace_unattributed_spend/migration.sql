-- AlterTable
ALTER TABLE "marketplaces" ADD COLUMN     "unattributedAmountRub" DECIMAL(12,2),
ADD COLUMN     "unattributedOperations" INTEGER,
ADD COLUMN     "unattributedSyncedAt" TIMESTAMP(3);
