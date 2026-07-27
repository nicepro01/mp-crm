-- CreateTable
CREATE TABLE "cogs_allocations" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "batchItemId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitCostRub" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cogs_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cogs_allocations_orderItemId_idx" ON "cogs_allocations"("orderItemId");

-- CreateIndex
CREATE INDEX "cogs_allocations_batchItemId_idx" ON "cogs_allocations"("batchItemId");

-- AddForeignKey
ALTER TABLE "cogs_allocations" ADD CONSTRAINT "cogs_allocations_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cogs_allocations" ADD CONSTRAINT "cogs_allocations_batchItemId_fkey" FOREIGN KEY ("batchItemId") REFERENCES "batch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
