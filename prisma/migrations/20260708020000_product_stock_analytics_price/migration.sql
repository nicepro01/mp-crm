-- Средняя цена продажи — есть в отчётах WB (в отличие от Ozon, где эти два
-- отчёта цену не дают вообще). Нужна для будущей юнит-экономики.
ALTER TABLE "product_stock_analytics" ADD COLUMN     "avgPriceRub" DECIMAL(10,2);
