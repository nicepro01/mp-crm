-- CreateTable
CREATE TABLE "return_claims" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "productId" TEXT,
    "externalId" TEXT NOT NULL,
    "mpSku" TEXT NOT NULL,
    "productName" TEXT,
    "status" INTEGER NOT NULL,
    "reasonText" TEXT,
    "priceRub" DECIMAL(10,2),
    "photos" JSONB,
    "orderDate" TIMESTAMP(3),
    "claimDate" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "return_claims_productId_idx" ON "return_claims"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "return_claims_marketplaceId_externalId_key" ON "return_claims"("marketplaceId", "externalId");

-- AddForeignKey
ALTER TABLE "return_claims" ADD CONSTRAINT "return_claims_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_claims" ADD CONSTRAINT "return_claims_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

