-- Короткий код продавца — надёжный ключ сопоставления между площадками
-- и файлами вроде калькулятора юнит-экономики.
ALTER TABLE "products" ADD COLUMN     "vendorCode" TEXT;
CREATE UNIQUE INDEX "products_vendorCode_key" ON "products"("vendorCode");

-- Расширение юнит-экономики под полный калькулятор (комиссия %, эквайринг,
-- другие услуги, % выкупа, итого к оплате, схема FBO/FBS, и details JSON
-- для всего остального — кластеры, базовый тариф, % соинвеста и т.д.).
ALTER TABLE "unit_economics" ADD COLUMN     "acquiringRub" DECIMAL(10,2),
ADD COLUMN     "buybackPct" DECIMAL(5,2),
ADD COLUMN     "details" JSONB,
ADD COLUMN     "mpCommissionPct" DECIMAL(5,2),
ADD COLUMN     "otherFeesRub" DECIMAL(10,2),
ADD COLUMN     "payoutRub" DECIMAL(10,2),
ADD COLUMN     "schemeType" TEXT;

CREATE UNIQUE INDEX "unit_economics_productId_marketplace_periodMonth_key" ON "unit_economics"("productId", "marketplace", "periodMonth");
