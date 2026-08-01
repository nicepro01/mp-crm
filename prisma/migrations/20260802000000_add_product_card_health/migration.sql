-- CreateTable
CREATE TABLE "product_card_health" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mpSku" TEXT NOT NULL,
    "contentRating" INTEGER,
    "priceIndexColor" TEXT,
    "priceIndexValue" DECIMAL(6,3),
    "competitorMinPriceRub" DECIMAL(10,2),
    "improveSuggestions" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_card_health_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_card_health_productId_idx" ON "product_card_health"("productId");

-- CreateIndex
CREATE INDEX "product_card_health_companyId_idx" ON "product_card_health"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "product_card_health_marketplaceId_mpSku_key" ON "product_card_health"("marketplaceId", "mpSku");

-- AddForeignKey
ALTER TABLE "product_card_health" ADD CONSTRAINT "product_card_health_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_card_health" ADD CONSTRAINT "product_card_health_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_card_health" ADD CONSTRAINT "product_card_health_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
