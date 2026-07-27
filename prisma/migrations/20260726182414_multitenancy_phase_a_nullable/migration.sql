-- AlterTable
ALTER TABLE "batch_items" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "cogs_allocations" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "marketplaces" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "credentials" JSONB;

-- AlterTable
ALTER TABLE "mp_import_items" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "mp_listings" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "product_cluster_analytics" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "product_cost_history" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "product_monthly_sales" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "product_stock_analytics" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "product_warehouse_analytics" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "return_claims" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "stock" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "supplier_prices" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "task_attachments" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "task_columns" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "unit_costs" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "unit_economics" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "companyId" TEXT;

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- CreateIndex
CREATE INDEX "batch_items_companyId_idx" ON "batch_items"("companyId");

-- CreateIndex
CREATE INDEX "batches_companyId_idx" ON "batches"("companyId");

-- CreateIndex
CREATE INDEX "cogs_allocations_companyId_idx" ON "cogs_allocations"("companyId");

-- CreateIndex
CREATE INDEX "mp_import_items_companyId_idx" ON "mp_import_items"("companyId");

-- CreateIndex
CREATE INDEX "mp_listings_companyId_idx" ON "mp_listings"("companyId");

-- CreateIndex
CREATE INDEX "order_items_companyId_idx" ON "order_items"("companyId");

-- CreateIndex
CREATE INDEX "orders_companyId_idx" ON "orders"("companyId");

-- CreateIndex
CREATE INDEX "product_cluster_analytics_companyId_idx" ON "product_cluster_analytics"("companyId");

-- CreateIndex
CREATE INDEX "product_cost_history_companyId_idx" ON "product_cost_history"("companyId");

-- CreateIndex
CREATE INDEX "product_monthly_sales_companyId_idx" ON "product_monthly_sales"("companyId");

-- CreateIndex
CREATE INDEX "product_stock_analytics_companyId_idx" ON "product_stock_analytics"("companyId");

-- CreateIndex
CREATE INDEX "product_warehouse_analytics_companyId_idx" ON "product_warehouse_analytics"("companyId");

-- CreateIndex
CREATE INDEX "products_companyId_idx" ON "products"("companyId");

-- CreateIndex
CREATE INDEX "return_claims_companyId_idx" ON "return_claims"("companyId");

-- CreateIndex
CREATE INDEX "stock_companyId_idx" ON "stock"("companyId");

-- CreateIndex
CREATE INDEX "supplier_prices_companyId_idx" ON "supplier_prices"("companyId");

-- CreateIndex
CREATE INDEX "suppliers_companyId_idx" ON "suppliers"("companyId");

-- CreateIndex
CREATE INDEX "task_attachments_companyId_idx" ON "task_attachments"("companyId");

-- CreateIndex
CREATE INDEX "task_columns_companyId_idx" ON "task_columns"("companyId");

-- CreateIndex
CREATE INDEX "tasks_companyId_idx" ON "tasks"("companyId");

-- CreateIndex
CREATE INDEX "unit_costs_companyId_idx" ON "unit_costs"("companyId");

-- CreateIndex
CREATE INDEX "unit_economics_companyId_idx" ON "unit_economics"("companyId");

-- CreateIndex
CREATE INDEX "warehouses_companyId_idx" ON "warehouses"("companyId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cost_history" ADD CONSTRAINT "product_cost_history_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_prices" ADD CONSTRAINT "supplier_prices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_costs" ADD CONSTRAINT "unit_costs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cogs_allocations" ADD CONSTRAINT "cogs_allocations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplaces" ADD CONSTRAINT "marketplaces_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_listings" ADD CONSTRAINT "mp_listings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mp_import_items" ADD CONSTRAINT "mp_import_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock" ADD CONSTRAINT "stock_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_economics" ADD CONSTRAINT "unit_economics_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stock_analytics" ADD CONSTRAINT "product_stock_analytics_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_cluster_analytics" ADD CONSTRAINT "product_cluster_analytics_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_warehouse_analytics" ADD CONSTRAINT "product_warehouse_analytics_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_monthly_sales" ADD CONSTRAINT "product_monthly_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_claims" ADD CONSTRAINT "return_claims_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_columns" ADD CONSTRAINT "task_columns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
