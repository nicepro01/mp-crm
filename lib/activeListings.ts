import { prisma } from "./prisma";

/**
 * Товар может продаваться на одной площадке и быть снят с продажи на
 * другой — реальная активность по площадке живёт в MpListing.isActive,
 * а не в глобальном Product.isActive (тот теперь значит "товар вообще
 * есть в ассортименте", а не "жив на всех площадках сразу"). Возвращает
 * набор ключей "productId|marketplaceCode", по которым листинг явно
 * помечен неактивным — такие строки надо скрывать из аналитики именно
 * для этой площадки, даже если на других товар жив.
 */
export async function getInactiveListingKeys(): Promise<Set<string>> {
  const inactive = await prisma.mpListing.findMany({
    where: { isActive: false },
    select: { productId: true, marketplace: { select: { code: true } } },
  });
  return new Set(inactive.map((l) => `${l.productId}|${l.marketplace.code}`));
}
