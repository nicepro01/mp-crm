import { prisma } from "./prisma";

export type MpListingSuggestion = {
  mpCommissionRub: string | null;
  mpLogisticsRub: string | null;
  storageRub: string | null;
  sellPriceRub: string | null;
  mpSku: string;
} | null;

/**
 * Подсказка комиссии/логистики МП/хранения/цены из листинга товара на
 * выбранной площадке. commissionPct хранится в % — переводим в рубли
 * по текущей цене листинга, т.к. в юнит-экономике нужна сумма в ₽/шт.
 */
export async function suggestMpListingCosts(
  productId: string,
  marketplaceId: string | null
): Promise<MpListingSuggestion> {
  if (!marketplaceId) return null;

  const listing = await prisma.mpListing.findFirst({
    where: { productId, marketplaceId },
    orderBy: { isActive: "desc" },
  });

  if (!listing) return null;

  const currentPrice = listing.currentPrice ? Number(listing.currentPrice) : null;
  const mpCommissionRub =
    currentPrice !== null
      ? ((currentPrice * Number(listing.commissionPct)) / 100).toFixed(2)
      : null;

  return {
    mpCommissionRub,
    mpLogisticsRub: listing.logisticsFeeRub ? listing.logisticsFeeRub.toString() : null,
    storageRub: listing.storageFeeRub ? listing.storageFeeRub.toString() : null,
    sellPriceRub: currentPrice !== null ? currentPrice.toFixed(2) : null,
    mpSku: listing.mpSku,
  };
}
