-- Разбиваем помесячные продажи по площадкам (WB/Ozon/ЯМ), а не только WB.
-- Существующие строки (собраны из WB) размечаем WB-площадкой.

-- AddColumn (nullable first, чтобы backfill'нуть существующие строки)
ALTER TABLE "product_monthly_sales" ADD COLUMN "marketplaceId" TEXT;

UPDATE "product_monthly_sales"
SET "marketplaceId" = (SELECT id FROM "marketplaces" WHERE code = 'WB');

ALTER TABLE "product_monthly_sales" ALTER COLUMN "marketplaceId" SET NOT NULL;

-- DropIndex
DROP INDEX "product_monthly_sales_productId_year_month_key";

-- CreateIndex
CREATE UNIQUE INDEX "product_monthly_sales_productId_marketplaceId_year_month_key" ON "product_monthly_sales"("productId", "marketplaceId", "year", "month");

-- AddForeignKey
ALTER TABLE "product_monthly_sales" ADD CONSTRAINT "product_monthly_sales_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
