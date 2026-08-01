import type { Marketplace } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";
import { fetchOzonCardRatings, fetchOzonPriceIndexes } from "./ozonApi";

// "Здоровье карточки" — контент-рейтинг (заполненность фото/текста/атрибутов)
// и индекс цены относительно рынка (реальный минимум цены у конкурентов —
// см. /v3/product/info/list price_indexes). Оба доступны без ограничений
// подписки Ozon — в отличие от рейтинга по отзывам покупателей (тот требует
// более высокий тариф Premium, проверено эмпирически: /v1/review/list и
// /v1/review/count у Premium Lite и Premium Plus вернули одинаковый
// PermissionDenied "not available with existing subscription").
export async function syncOzonCardHealth(marketplace: Marketplace) {
  const listings = await prisma.mpListing.findMany({
    where: { marketplaceId: marketplace.id },
    select: { productId: true, mpSku: true },
  });
  if (listings.length === 0) {
    return { total: 0, updated: 0, notFound: 0 };
  }

  const productIdByMpSku = new Map(listings.map((l) => [l.mpSku, l.productId]));
  const skus = listings.map((l) => Number(l.mpSku)).filter((n) => Number.isFinite(n));

  const [ratings, priceIndexes] = await Promise.all([
    fetchOzonCardRatings(marketplace.id, skus),
    fetchOzonPriceIndexes(marketplace.id, skus),
  ]);

  const ratingBySku = new Map(ratings.map((r) => [String(r.sku), r]));
  const priceIndexBySku = new Map(priceIndexes.map((p) => [String(p.sku), p]));

  const summary = { total: 0, updated: 0, notFound: 0 };

  for (const mpSku of new Set([...ratingBySku.keys(), ...priceIndexBySku.keys()])) {
    summary.total++;
    const productId = productIdByMpSku.get(mpSku);
    if (!productId) {
      summary.notFound++;
      continue;
    }

    const rating = ratingBySku.get(mpSku);
    const priceIndex = priceIndexBySku.get(mpSku);

    await prisma.productCardHealth.upsert({
      where: { marketplaceId_mpSku: { marketplaceId: marketplace.id, mpSku } },
      create: {
        companyId: getCurrentCompanyId(),
        marketplaceId: marketplace.id,
        productId,
        mpSku,
        contentRating: rating?.rating ?? null,
        improveSuggestions: rating ? (rating.unfulfilledConditions as any) : undefined,
        priceIndexColor: priceIndex?.colorIndex ?? null,
        priceIndexValue: priceIndex?.priceIndexValue ?? null,
        competitorMinPriceRub: priceIndex?.competitorMinPriceRub ?? null,
      },
      update: {
        productId,
        contentRating: rating?.rating ?? null,
        improveSuggestions: rating ? (rating.unfulfilledConditions as any) : undefined,
        priceIndexColor: priceIndex?.colorIndex ?? null,
        priceIndexValue: priceIndex?.priceIndexValue ?? null,
        competitorMinPriceRub: priceIndex?.competitorMinPriceRub ?? null,
        syncedAt: new Date(),
      },
    });
    summary.updated++;
  }

  return summary;
}
