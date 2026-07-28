-- AlterTable
ALTER TABLE "marketplace_daily_funnel" ADD COLUMN     "boughtOutSumRub" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cancelledSumRub" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "orderedSumRub" DECIMAL(12,2) NOT NULL DEFAULT 0;
