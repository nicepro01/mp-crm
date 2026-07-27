-- DropIndex
DROP INDEX "batches_batchNumber_key";

-- DropIndex
DROP INDEX "marketplaces_code_key";

-- DropIndex
DROP INDEX "products_barcode_key";

-- DropIndex
DROP INDEX "products_sku_key";

-- DropIndex
DROP INDEX "products_vendorCode_key";

-- AlterTable
ALTER TABLE "batch_items" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "batches" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "cogs_allocations" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "marketplaces" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "mp_import_items" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "mp_listings" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "order_items" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "product_cluster_analytics" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "product_cost_history" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "product_monthly_sales" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "product_stock_analytics" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "product_warehouse_analytics" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "return_claims" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "stock" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "supplier_prices" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "suppliers" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "task_attachments" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "task_columns" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "tasks" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "unit_costs" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "unit_economics" ALTER COLUMN "companyId" SET NOT NULL;

-- AlterTable
ALTER TABLE "warehouses" ALTER COLUMN "companyId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "batches_companyId_batchNumber_key" ON "batches"("companyId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "marketplaces_companyId_code_key" ON "marketplaces"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "products_companyId_sku_key" ON "products"("companyId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_companyId_barcode_key" ON "products"("companyId", "barcode");

-- CreateIndex
CREATE UNIQUE INDEX "products_companyId_vendorCode_key" ON "products"("companyId", "vendorCode");

