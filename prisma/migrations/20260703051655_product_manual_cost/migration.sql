-- AlterTable
ALTER TABLE "products" ADD COLUMN     "manualCostRub" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "product_cost_history" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "oldCost" DECIMAL(12,2),
    "newCost" DECIMAL(12,2) NOT NULL,
    "comment" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_cost_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_cost_history_productId_changedAt_idx" ON "product_cost_history"("productId", "changedAt");

-- AddForeignKey
ALTER TABLE "product_cost_history" ADD CONSTRAINT "product_cost_history_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
