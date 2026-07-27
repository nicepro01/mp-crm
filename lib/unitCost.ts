import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";

/**
 * Себестоимость юнита позиции поставки = закупочная цена за штуку как есть —
 * никакой курсовой/логистической математики на уровне поставки больше нет
 * (цена уже готовое число в рублях). Структура UnitCost (product/logistics/
 * landed) сохранена ради FIFO/CogsAllocation, но logisticsCostRub всегда 0.
 */
export async function calculateAndSaveUnitCost(batchItemId: string) {
  const batchItem = await prisma.batchItem.findUniqueOrThrow({
    where: { id: batchItemId },
  });

  const landedCostRub = new Prisma.Decimal(batchItem.purchasePriceRub).toDecimalPlaces(2);

  return prisma.unitCost.upsert({
    where: { batchItemId },
    create: {
      companyId: getCurrentCompanyId(),
      batchItemId,
      productCostRub: landedCostRub,
      logisticsCostRub: 0,
      landedCostRub,
    },
    update: {
      productCostRub: landedCostRub,
      logisticsCostRub: 0,
      landedCostRub,
      calculatedAt: new Date(),
    },
  });
}

/** Пересчитать UnitCost всех позиций поставки — на случай правки цены позиции. */
export async function recalculateUnitCostsForBatch(batchId: string) {
  const items = await prisma.batchItem.findMany({
    where: { batchId },
    select: { id: true },
  });
  for (const item of items) {
    await calculateAndSaveUnitCost(item.id);
  }
}
