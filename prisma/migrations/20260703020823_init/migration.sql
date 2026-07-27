-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_PAID', 'DEPOSIT_PAID', 'FULLY_PAID');

-- CreateEnum
CREATE TYPE "LogisticsStatus" AS ENUM ('PLANNED', 'PRODUCTION', 'IN_TRANSIT', 'CUSTOMS', 'ARRIVED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "MarketplaceCode" AS ENUM ('WB', 'OZON', 'YANDEX_MARKET');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('OWN_B2B', 'MARKETPLACE_FBO', 'MARKETPLACE_FBS');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('B2B', 'WB', 'OZON', 'YANDEX_MARKET');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED');

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "photoUrl" TEXT,
    "itemWeightG" DECIMAL(10,2) NOT NULL,
    "itemLengthMm" INTEGER NOT NULL,
    "itemWidthMm" INTEGER NOT NULL,
    "itemHeightMm" INTEGER NOT NULL,
    "unitsPerBox" INTEGER NOT NULL,
    "boxWeightKg" DECIMAL(10,3) NOT NULL,
    "boxLengthMm" INTEGER NOT NULL,
    "boxWidthMm" INTEGER NOT NULL,
    "boxHeightMm" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactInfo" TEXT,
    "paymentTerms" TEXT,
    "moq" INTEGER,
    "leadTimeDays" INTEGER,
    "rating" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_prices" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "priceCny" DECIMAL(12,4) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "minQty" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "etaDate" TIMESTAMP(3),
    "arrivedDate" TIMESTAMP(3),
    "cnyToRubRate" DECIMAL(10,4) NOT NULL,
    "usdToRubRate" DECIMAL(10,4),
    "logisticsRatePerKg" DECIMAL(10,4) NOT NULL,
    "logisticsRatePerCbm" DECIMAL(10,4),
    "totalAmountCny" DECIMAL(14,2) NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_PAID',
    "depositAmountCny" DECIMAL(14,2),
    "logisticsStatus" "LogisticsStatus" NOT NULL DEFAULT 'PLANNED',
    "trackingNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_items" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "priceCnyActual" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_costs" (
    "id" TEXT NOT NULL,
    "batchItemId" TEXT NOT NULL,
    "productCostRub" DECIMAL(12,2) NOT NULL,
    "logisticsCostRub" DECIMAL(12,2) NOT NULL,
    "landedCostRub" DECIMAL(12,2) NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplaces" (
    "id" TEXT NOT NULL,
    "code" "MarketplaceCode" NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "marketplaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mp_listings" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "mpSku" TEXT NOT NULL,
    "mpProductId" TEXT,
    "commissionPct" DECIMAL(5,2) NOT NULL,
    "logisticsFeeRub" DECIMAL(10,2),
    "storageFeeRub" DECIMAL(10,2),
    "currentPrice" DECIMAL(10,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "mp_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL,
    "marketplaceId" TEXT,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "qtyAvailable" INTEGER NOT NULL,
    "qtyReserved" INTEGER NOT NULL DEFAULT 0,
    "qtyInTransit" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncSource" TEXT,

    CONSTRAINT "stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "channel" "OrderChannel" NOT NULL,
    "externalId" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "customerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "priceRub" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_economics" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "marketplace" "MarketplaceCode",
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "cogsRub" DECIMAL(10,2) NOT NULL,
    "inboundLogisticsRub" DECIMAL(10,2) NOT NULL,
    "mpCommissionRub" DECIMAL(10,2) NOT NULL,
    "mpLogisticsRub" DECIMAL(10,2) NOT NULL,
    "storageRub" DECIMAL(10,2) NOT NULL,
    "adsRub" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "taxRub" DECIMAL(10,2) NOT NULL,
    "laborAllocRub" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sellPriceRub" DECIMAL(10,2) NOT NULL,
    "netMarginRub" DECIMAL(10,2) NOT NULL,
    "netMarginPct" DECIMAL(6,2) NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_economics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "supplier_prices_productId_supplierId_idx" ON "supplier_prices"("productId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "batches_batchNumber_key" ON "batches"("batchNumber");

-- CreateIndex
CREATE INDEX "batch_items_batchId_idx" ON "batch_items"("batchId");

-- CreateIndex
CREATE INDEX "batch_items_productId_idx" ON "batch_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "unit_costs_batchItemId_key" ON "unit_costs"("batchItemId");

-- CreateIndex
CREATE UNIQUE INDEX "marketplaces_code_key" ON "marketplaces"("code");

-- CreateIndex
CREATE UNIQUE INDEX "mp_listings_marketplaceId_mpSku_key" ON "mp_listings"("marketplaceId", "mpSku");

-- CreateIndex
CREATE UNIQUE INDEX "stock_productId_warehouseId_key" ON "stock"("productId", "warehouseId");

-- CreateIndex
CREATE INDEX "unit_economics_productId_periodMonth_idx" ON "unit_economics"("productId", "periodMonth");

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_costs" ADD CONSTRAINT "unit_costs_batchItemId_fkey" FOREIGN KEY ("batchItemId") REFERENCES "batch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_listings" ADD CONSTRAINT "mp_listings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_listings" ADD CONSTRAINT "mp_listings_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_economics" ADD CONSTRAINT "unit_economics_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
