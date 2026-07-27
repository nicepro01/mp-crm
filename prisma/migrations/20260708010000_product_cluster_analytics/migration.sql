-- Аналитика по кластерам (регионам) Ozon — тот же набор метрик, что и в
-- product_stock_analytics, но в разрезе по региону, чтобы находить перекос
-- остатков между складами Ozon (дефицит в одном регионе, избыток в другом).
CREATE TABLE "product_cluster_analytics" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mpSku" TEXT NOT NULL,
    "clusterName" TEXT NOT NULL,
    "liquidityStatus" TEXT,
    "daysOfStockLeft" INTEGER,
    "avgDailySalesQty" DECIMAL(10,2) NOT NULL,
    "daysWithoutSales" INTEGER,
    "qtyAvailable" INTEGER NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_cluster_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_cluster_analytics_productId_idx" ON "product_cluster_analytics"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_cluster_analytics_marketplaceId_mpSku_clusterName_key" ON "product_cluster_analytics"("marketplaceId", "mpSku", "clusterName");

-- AddForeignKey
ALTER TABLE "product_cluster_analytics" ADD CONSTRAINT "product_cluster_analytics_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cluster_analytics" ADD CONSTRAINT "product_cluster_analytics_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
