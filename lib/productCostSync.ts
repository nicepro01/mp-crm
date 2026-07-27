import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";

/**
 * Синк закупочной цены товара из позиции поставки. Вызывается при каждом
 * сохранении BatchItem (создание/правка цены): если цена в позиции
 * отличается от текущей Product.purchasePriceRub — обновляем товар и
 * пишем запись в ProductCostHistory со ссылкой на эту позицию/поставку.
 * Ручного редактирования истории нет — только так, через поставки.
 */
export async function syncProductPurchasePrice(batchItemId: string) {
  const batchItem = await prisma.batchItem.findUniqueOrThrow({
    where: { id: batchItemId },
    include: { product: true },
  });

  const newCost = batchItem.purchasePriceRub;
  const oldCost = batchItem.product.purchasePriceRub;
  const changed = oldCost === null || !oldCost.equals(newCost);

  if (!changed) return;

  await prisma.$transaction([
    prisma.productCostHistory.create({
      data: {
        companyId: getCurrentCompanyId(),
        productId: batchItem.productId,
        oldCost,
        newCost,
        batchItemId: batchItem.id,
      },
    }),
    prisma.product.update({
      where: { id: batchItem.productId },
      data: { purchasePriceRub: newCost },
    }),
  ]);
}

/**
 * Ручная правка закупочной цены прямо в карточке товара — нужна как
 * временное/стартовое значение, пока не пришла первая поставка с реальной
 * ценой. Поставка всегда побеждает: как только по этому товару сохранится
 * BatchItem с ценой, syncProductPurchasePrice выше перезапишет её снова.
 */
export async function setManualPurchasePrice(productId: string, newCost: number | null) {
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  const oldCost = product.purchasePriceRub;

  // Очистка цены (newCost === null) — просто сбрасываем значение, без
  // записи в историю: newCost там обязателен, а "было X, стало ничего"
  // логировать нечем.
  if (newCost === null) {
    if (oldCost === null) return;
    await prisma.product.update({ where: { id: productId }, data: { purchasePriceRub: null } });
    return;
  }

  const changed = oldCost === null || !oldCost.equals(newCost);
  if (!changed) return;

  await prisma.$transaction([
    prisma.productCostHistory.create({
      data: { companyId: getCurrentCompanyId(), productId, oldCost, newCost, batchItemId: null },
    }),
    prisma.product.update({
      where: { id: productId },
      data: { purchasePriceRub: newCost },
    }),
  ]);
}
