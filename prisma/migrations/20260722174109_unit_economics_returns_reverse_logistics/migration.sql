-- AlterTable
ALTER TABLE "unit_economics" ADD COLUMN     "returnsQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reverseLogisticsRub" DECIMAL(10,2);
