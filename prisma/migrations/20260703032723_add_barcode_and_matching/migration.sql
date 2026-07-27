-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'MATCHED', 'IGNORED');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" TEXT;

-- CreateTable
CREATE TABLE "mp_import_items" (
    "id" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "mpSku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "matchedProductId" TEXT,
    "matchedVia" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "mp_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mp_import_items_status_idx" ON "mp_import_items"("status");

-- CreateIndex
CREATE UNIQUE INDEX "mp_import_items_marketplaceId_mpSku_key" ON "mp_import_items"("marketplaceId", "mpSku");

-- CreateIndex
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");

-- AddForeignKey
ALTER TABLE "mp_import_items" ADD CONSTRAINT "mp_import_items_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_import_items" ADD CONSTRAINT "mp_import_items_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
