-- BatchItem.supplierId становится необязательным: подставляется автоматически
-- из Product.supplierId при сохранении позиции, но не блокирует добавление,
-- если у товара основной поставщик ещё не указан. FK остаётся RESTRICT —
-- нельзя удалить поставщика, если на него уже ссылаются реальные позиции.
ALTER TABLE "batch_items" ALTER COLUMN "supplierId" DROP NOT NULL;

-- Product.supplierId — основной поставщик товара (мягкая связь, SET NULL).
ALTER TABLE "products" ADD COLUMN     "supplierId" TEXT;

ALTER TABLE "products" ADD CONSTRAINT "products_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
