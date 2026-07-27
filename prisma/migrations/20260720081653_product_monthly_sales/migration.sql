-- CreateTable
CREATE TABLE "product_monthly_sales" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "qtySold" INTEGER NOT NULL,
    "daysInPeriod" INTEGER NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_monthly_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_monthly_sales_productId_idx" ON "product_monthly_sales"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_monthly_sales_productId_year_month_key" ON "product_monthly_sales"("productId", "year", "month");

-- AddForeignKey
ALTER TABLE "product_monthly_sales" ADD CONSTRAINT "product_monthly_sales_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
