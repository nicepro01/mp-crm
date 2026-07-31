-- Разрешаем несколько строк Marketplace одного code на компанию (напр. два
-- кабинета Ozon) — уникальность переезжает с code на name, т.к. name это то,
-- чем пользователь их отличает ("Ozon" / "Ozon 2").
DROP INDEX "marketplaces_companyId_code_key";
CREATE INDEX "marketplaces_companyId_code_idx" ON "marketplaces"("companyId", "code");
CREATE UNIQUE INDEX "marketplaces_companyId_name_key" ON "marketplaces"("companyId", "name");

-- UnitEconomics раньше был привязан к площадке через enum-код (marketplace),
-- что не различает несколько строк одного кода. Добавляем marketplaceId и
-- бэкафилим его из существующих данных (на момент миграции на company+code
-- приходится ровно одна строка Marketplace, так что джойн однозначный).
ALTER TABLE "unit_economics" ADD COLUMN "marketplaceId" TEXT;

UPDATE "unit_economics" ue
SET "marketplaceId" = m.id
FROM "marketplaces" m
WHERE ue."companyId" = m."companyId"
  AND ue.marketplace IS NOT NULL
  AND m.code = ue.marketplace;

DROP INDEX "unit_economics_productId_marketplace_periodMonth_key";
CREATE UNIQUE INDEX "unit_economics_productId_marketplaceId_periodMonth_key" ON "unit_economics"("productId", "marketplaceId", "periodMonth");

ALTER TABLE "unit_economics" ADD CONSTRAINT "unit_economics_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
