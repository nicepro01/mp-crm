import { prisma } from "./prisma";

export type LatestCost = { landedCostRub: string; source: "fifo" | "batch" };

/**
 * Последняя известная себестоимость по каждому товару — приоритет как
 * в остальной юнит-экономике: сначала факт последнего FIFO-списания
 * (реальная продажа), иначе landedCost последней партии (закупили, но
 * ещё не продавали). Считается одним проходом по всем товарам сразу —
 * для списка так на порядок дешевле, чем N+1 запрос на товар.
 */
export async function getLatestCostByProduct(): Promise<Map<string, LatestCost>> {
  const result = new Map<string, LatestCost>();

  const allocations = await prisma.cogsAllocation.findMany({
    select: {
      unitCostRub: true,
      createdAt: true,
      orderItem: { select: { productId: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  for (const a of allocations) {
    const pid = a.orderItem.productId;
    if (!result.has(pid)) {
      result.set(pid, { landedCostRub: a.unitCostRub.toString(), source: "fifo" });
    }
  }

  const batchItems = await prisma.batchItem.findMany({
    where: { unitCost: { isNot: null } },
    select: {
      productId: true,
      unitCost: { select: { landedCostRub: true } },
      batch: { select: { orderDate: true } },
    },
    orderBy: { batch: { orderDate: "desc" } },
  });
  for (const bi of batchItems) {
    if (!result.has(bi.productId) && bi.unitCost) {
      result.set(bi.productId, {
        landedCostRub: bi.unitCost.landedCostRub.toString(),
        source: "batch",
      });
    }
  }

  return result;
}
