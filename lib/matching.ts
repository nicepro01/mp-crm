import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";

export type MatchResolution =
  | { status: "MATCHED"; matchedProductId: string; matchedVia: "mp_listing" | "barcode" }
  | { status: "PENDING"; matchedProductId: null; matchedVia: null };

/**
 * Приоритет автосопоставления входящей позиции с площадки:
 * 1) уже есть привязка в MpListing (marketplaceId+mpSku) — это финальный источник истины;
 * 2) штрихкод товара совпал с Product.barcode — надёжнее, чем произвольный vendorCode;
 * 3) иначе PENDING — ждёт ручного выбора на /matching. Product НИКОГДА
 *    не создаётся автоматически на этом шаге.
 */
export async function resolveImportItem(item: {
  marketplaceId: string;
  mpSku: string;
  barcode: string | null;
}): Promise<MatchResolution> {
  const listing = await prisma.mpListing.findUnique({
    where: {
      marketplaceId_mpSku: {
        marketplaceId: item.marketplaceId,
        mpSku: item.mpSku,
      },
    },
  });
  if (listing) {
    return { status: "MATCHED", matchedProductId: listing.productId, matchedVia: "mp_listing" };
  }

  if (item.barcode) {
    const product = await prisma.product.findFirst({
      where: { barcode: item.barcode },
    });
    if (product) {
      return { status: "MATCHED", matchedProductId: product.id, matchedVia: "barcode" };
    }
  }

  return { status: "PENDING", matchedProductId: null, matchedVia: null };
}

export type ImportRowOutcome =
  | { status: "matched"; matchedVia: "mp_listing" | "barcode"; matchedProductId: string }
  | { status: "pending" }
  | { status: "skipped"; matchedProductId: string | null }; // уже был решён раньше — не трогаем

/**
 * Общая точка входа для любого источника входящих позиций с площадки
 * (тестовый импорт на /matching, импорт остатков из CSV/Excel и т.д.):
 * находит/создаёт запись в MpImportItem и резолвит её через
 * resolveImportItem. Повторный импорт того же mpSku не переписывает уже
 * решённые вручную записи — только PENDING пересчитываются заново.
 */
export async function upsertImportItem(params: {
  marketplaceId: string;
  mpSku: string;
  barcode: string | null;
  name?: string | null;
}): Promise<ImportRowOutcome> {
  const { marketplaceId, mpSku, barcode, name = null } = params;

  const existing = await prisma.mpImportItem.findUnique({
    where: { marketplaceId_mpSku: { marketplaceId, mpSku } },
  });

  if (existing && existing.status !== "PENDING") {
    return { status: "skipped", matchedProductId: existing.matchedProductId };
  }

  const resolution = await resolveImportItem({ marketplaceId, mpSku, barcode });

  const payload = {
    companyId: getCurrentCompanyId(),
    marketplaceId,
    mpSku,
    barcode,
    name,
    status: resolution.status,
    matchedProductId: resolution.matchedProductId,
    matchedVia: resolution.matchedVia,
    resolvedAt: resolution.status === "MATCHED" ? new Date() : null,
  };

  if (existing) {
    await prisma.mpImportItem.update({ where: { id: existing.id }, data: payload });
  } else {
    await prisma.mpImportItem.create({ data: payload });
  }

  if (resolution.status === "MATCHED") {
    return {
      status: "matched",
      matchedVia: resolution.matchedVia,
      matchedProductId: resolution.matchedProductId,
    };
  }
  return { status: "pending" };
}
