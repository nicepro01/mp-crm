import type { MarketplaceCode } from "@prisma/client";
import { prisma } from "./prisma";
import { MarketplaceNotConfiguredError } from "./syncErrors";

const CODE_LABELS: Record<MarketplaceCode, string> = {
  WB: "WB",
  OZON: "Ozon",
  YANDEX_MARKET: "Яндекс.Маркет",
};

// У компании может быть несколько строк Marketplace одного code (напр. два
// магазина Ozon) — если roут получил конкретный marketplaceId (напр. из
// выбранной вкладки в UI), резолвим по нему; иначе (старые кнопки без
// выбора площадки) берём первую строку этого code — совпадает с поведением
// системы до появления второго магазина, когда строка была всегда одна.
export async function resolveMarketplace(code: MarketplaceCode, marketplaceId?: string | null) {
  const marketplace = marketplaceId
    ? await prisma.marketplace.findUnique({ where: { id: marketplaceId } })
    : await prisma.marketplace.findFirst({ where: { code } });
  if (!marketplace) {
    throw new MarketplaceNotConfiguredError(
      `Площадка ${CODE_LABELS[code]} не найдена — сначала добавьте её на странице «Площадки»`
    );
  }
  return marketplace;
}
