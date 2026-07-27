-- Product: закупочная цена больше не редактируется вручную, она приезжает
-- из поставок — переименовываем поле, данные сохраняются.
ALTER TABLE "products" RENAME COLUMN "manualCostRub" TO "purchasePriceRub";

-- BatchItem: цена больше не в CNY с пересчётом курса, а готовое число в ₽.
ALTER TABLE "batch_items" RENAME COLUMN "priceCnyActual" TO "purchasePriceRub";
ALTER TABLE "batch_items" ALTER COLUMN "purchasePriceRub" TYPE DECIMAL(12,2);

-- ProductCostHistory: убираем ручной комментарий, добавляем ссылку на позицию
-- поставки, которая вызвала изменение цены.
ALTER TABLE "product_cost_history" DROP COLUMN "comment";
ALTER TABLE "product_cost_history" ADD COLUMN "batchItemId" TEXT;
ALTER TABLE "product_cost_history" ADD CONSTRAINT "product_cost_history_batchItemId_fkey" FOREIGN KEY ("batchItemId") REFERENCES "batch_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Batch: убираем курс/логистику/оплату — поставка теперь просто накладная
-- с датами и статусом логистики, цена целиком живёт в позициях.
ALTER TABLE "batches" DROP COLUMN "cnyToRubRate";
ALTER TABLE "batches" DROP COLUMN "usdToRubRate";
ALTER TABLE "batches" DROP COLUMN "logisticsRatePerKg";
ALTER TABLE "batches" DROP COLUMN "logisticsRatePerCbm";
ALTER TABLE "batches" DROP COLUMN "totalAmountCny";
ALTER TABLE "batches" DROP COLUMN "paymentStatus";
ALTER TABLE "batches" DROP COLUMN "depositAmountCny";
ALTER TABLE "batches" DROP COLUMN "trackingNumber";

DROP TYPE "PaymentStatus";
