-- AlterTable: дата отгрузки на партию
ALTER TABLE "batches" ADD COLUMN "shipmentDate" TIMESTAMP(3);

-- AlterTable: поставщик переезжает с партии на позицию партии
-- 1) добавляем колонку nullable, чтобы можно было сначала перенести данные
ALTER TABLE "batch_items" ADD COLUMN "supplierId" TEXT;

-- 2) бэкфилл: у существующих позиций проставляем поставщика их партии
UPDATE "batch_items" bi
SET "supplierId" = b."supplierId"
FROM "batches" b
WHERE b.id = bi."batchId";

-- 3) теперь можно сделать колонку обязательной
ALTER TABLE "batch_items" ALTER COLUMN "supplierId" SET NOT NULL;

-- 4) FK и индекс на новую колонку
ALTER TABLE "batch_items" ADD CONSTRAINT "batch_items_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "batch_items_supplierId_idx" ON "batch_items"("supplierId");

-- 5) убираем старую связь партия -> поставщик
ALTER TABLE "batches" DROP CONSTRAINT "batches_supplierId_fkey";
ALTER TABLE "batches" DROP COLUMN "supplierId";
