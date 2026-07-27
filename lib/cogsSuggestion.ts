import { prisma } from "./prisma";

export type CogsSuggestion = {
  cogsRub: string | null;
  source: "fifo" | "latest_batch" | "none";
  qtySold: number;
};

/**
 * Подсказка себестоимости для дашборда юнит-экономики:
 * 1) средневзвешенная FIFO-себестоимость реально проданного за период —
 *    самая точная цифра, т.к. использует настоящий журнал списаний;
 * 2) если в периоде продаж не было — берём landedCost последней партии
 *    как ориентир (товар ещё не продавался, но закупочная цена известна).
 */
export async function suggestCogsRub(
  productId: string,
  periodMonth: Date,
  marketplace: string | null
): Promise<CogsSuggestion> {
  const start = new Date(
    Date.UTC(periodMonth.getUTCFullYear(), periodMonth.getUTCMonth(), 1)
  );
  const end = new Date(
    Date.UTC(periodMonth.getUTCFullYear(), periodMonth.getUTCMonth() + 1, 1)
  );

  const allocations = await prisma.cogsAllocation.findMany({
    where: {
      orderItem: {
        productId,
        order: {
          orderDate: { gte: start, lt: end },
          ...(marketplace ? { channel: marketplace as any } : {}),
        },
      },
    },
  });

  if (allocations.length > 0) {
    const totalQty = allocations.reduce((sum, a) => sum + a.qty, 0);
    const totalCost = allocations.reduce(
      (sum, a) => sum + a.qty * Number(a.unitCostRub),
      0
    );
    return {
      cogsRub: (totalCost / totalQty).toFixed(2),
      source: "fifo",
      qtySold: totalQty,
    };
  }

  const latestItem = await prisma.batchItem.findFirst({
    where: { productId, unitCost: { isNot: null } },
    include: { unitCost: true },
    orderBy: { batch: { orderDate: "desc" } },
  });

  if (latestItem?.unitCost) {
    return {
      cogsRub: latestItem.unitCost.landedCostRub.toString(),
      source: "latest_batch",
      qtySold: 0,
    };
  }

  return { cogsRub: null, source: "none", qtySold: 0 };
}
