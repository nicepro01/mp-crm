-- CreateTable
CREATE TABLE "product_warehouse_analytics" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mpSku" TEXT NOT NULL,
    "warehouseName" TEXT NOT NULL,
    "qtyAvailable" INTEGER NOT NULL,
    "avgDailySalesQty" DECIMAL(10,2) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_warehouse_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_warehouse_analytics_productId_idx" ON "product_warehouse_analytics"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_warehouse_analytics_marketplaceId_mpSku_warehouseNa_key" ON "product_warehouse_analytics"("marketplaceId", "mpSku", "warehouseName");

-- AddForeignKey
ALTER TABLE "product_warehouse_analytics" ADD CONSTRAINT "product_warehouse_analytics_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_warehouse_analytics" ADD CONSTRAINT "product_warehouse_analytics_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
