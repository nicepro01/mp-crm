import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";

export class InsufficientStockError extends Error {}

/**
 * FIFO-списание себестоимости при продаже: расходуем BatchItem-ы товара
 * от самой старой партии (по batch.orderDate) к самой новой, пока не
 * наберём нужное количество. Каждое списание фиксируется отдельной
 * записью CogsAllocation со снимком landedCostRub партии на тот момент —
 * это и есть себестоимость проданной единицы для юнит-экономики.
 */
export async function allocateCogsFifo(orderItemId: string) {
  return prisma.$transaction(async (tx) => {
    const orderItem = await tx.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
    });

    const alreadyAllocated = await tx.cogsAllocation.count({
      where: { orderItemId },
    });
    if (alreadyAllocated > 0) {
      throw new Error("Себестоимость для этой позиции заказа уже списана");
    }

    const batchItems = await tx.batchItem.findMany({
      where: { productId: orderItem.productId },
      include: { batch: true, unitCost: true, cogsAllocations: true },
      orderBy: { batch: { orderDate: "asc" } },
    });

    let remaining = orderItem.qty;
    const allocations: Prisma.CogsAllocationCreateManyInput[] = [];

    for (const bi of batchItems) {
      if (remaining <= 0) break;
      if (!bi.unitCost) continue; // себестоимость ещё не рассчитана — пропускаем

      const consumed = bi.cogsAllocations.reduce((sum, a) => sum + a.qty, 0);
      const available = bi.qty - consumed;
      if (available <= 0) continue;

      const take = Math.min(available, remaining);
      allocations.push({
        companyId: getCurrentCompanyId(),
        orderItemId,
        batchItemId: bi.id,
        qty: take,
        unitCostRub: bi.unitCost.landedCostRub,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      throw new InsufficientStockError(
        `Недостаточно партий для FIFO-списания: не хватает ${remaining} шт. товара с рассчитанной себестоимостью`
      );
    }

    await tx.cogsAllocation.createMany({ data: allocations });

    return tx.cogsAllocation.findMany({ where: { orderItemId } });
  });
}

export async function getOrderItemCogs(orderItemId: string) {
  const allocations = await prisma.cogsAllocation.findMany({
    where: { orderItemId },
    include: { batchItem: { include: { batch: true } } },
    orderBy: { createdAt: "asc" },
  });

  const totalCogsRub = allocations.reduce(
    (sum, a) => sum.plus(a.unitCostRub.times(a.qty)),
    new Prisma.Decimal(0)
  );
  const totalQty = allocations.reduce((sum, a) => sum + a.qty, 0);

  return { allocations, totalCogsRub, totalQty };
}
