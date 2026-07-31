import { prisma } from "./prisma";

/**
 * Товар может продаваться в одном магазине и быть снят с продажи в
 * другом — реальная активность живёт в MpListing.isActive, а не в
 * глобальном Product.isActive (тот теперь значит "товар вообще есть в
 * ассортименте", а не "жив везде сразу"). Возвращает набор ключей
 * "productId|marketplaceId", по которым листинг явно помечен неактивным —
 * такие строки надо скрывать из аналитики именно для этого магазина, даже
 * если в других (в т.ч. другом магазине той же площадки) товар жив. Ключ —
 * marketplaceId, не code: два магазина одной площадки (напр. два Ozon)
 * должны деактивироваться независимо друг от друга.
 */
export async function getInactiveListingKeys(): Promise<Set<string>> {
  const inactive = await prisma.mpListing.findMany({
    where: { isActive: false },
    select: { productId: true, marketplaceId: true },
  });
  return new Set(inactive.map((l) => `${l.productId}|${l.marketplaceId}`));
}
