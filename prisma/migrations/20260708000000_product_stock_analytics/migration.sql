-- Снимок готовых метрик скорости продаж/ликвидности с площадки (у Ozon —
-- лист "Товары" отчёта "Оборачиваемость"). Храним только последний снимок
-- на пару (marketplaceId, mpSku), как и Stock.
CREATE TABLE "product_stock_analytics" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mpSku" TEXT NOT NULL,
    "liquidityStatus" TEXT,
    "daysOfStockLeft" INTEGER,
    "avgDailySalesQty" DECIMAL(10,2) NOT NULL,
    "daysWithoutSales" INTEGER,
    "qtyAvailable" INTEGER NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_stock_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_stock_analytics_productId_idx" ON "product_stock_analytics"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_stock_analytics_marketplaceId_mpSku_key" ON "product_stock_analytics"("marketplaceId", "mpSku");

-- AddForeignKey
ALTER TABLE "product_stock_analytics" ADD CONSTRAINT "product_stock_analytics_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stock_analytics" ADD CONSTRAINT "product_stock_analytics_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
