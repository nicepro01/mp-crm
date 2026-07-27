import { prisma } from "./prisma";

export type SupplierPurchaseHistoryEntry = {
  supplierId: string;
  supplierName: string;
  lastPriceRub: string;
  lastOrderDate: Date;
  totalQty: number;
  shipmentsCount: number;
};

/**
 * Реальная история закупок товара по поставщикам — из позиций поставок
 * (BatchItem), а не из прайс-листа SupplierPrice. Показывает "закупали у X",
 * даже если явную цену от поставщика никогда не заводили в справочник.
 */
export async function getSupplierPurchaseHistoryForProduct(
  productId: string
): Promise<SupplierPurchaseHistoryEntry[]> {
  const items = await prisma.batchItem.findMany({
    // Позиции без поставщика (ещё не указан у товара на момент поставки)
    // не с кем группировать — пропускаем их здесь.
    where: { productId, supplierId: { not: null } },
    include: { supplier: true, batch: true },
    orderBy: { batch: { orderDate: "desc" } },
  });

  const map = new Map<string, SupplierPurchaseHistoryEntry>();

  for (const item of items) {
    if (!item.supplierId || !item.supplier) continue;
    const existing = map.get(item.supplierId);
    if (!existing) {
      map.set(item.supplierId, {
        supplierId: item.supplierId,
        supplierName: item.supplier.name,
        lastPriceRub: item.purchasePriceRub.toString(),
        lastOrderDate: item.batch.orderDate,
        totalQty: item.qty,
        shipmentsCount: 1,
      });
    } else {
      existing.totalQty += item.qty;
      existing.shipmentsCount += 1;
    }
  }

  return Array.from(map.values());
}

export type ProductPurchaseHistoryEntry = {
  productId: string;
  productSku: string;
  productName: string;
  lastPriceRub: string;
  lastOrderDate: Date;
  totalQty: number;
  shipmentsCount: number;
};

/** То же самое, но с точки зрения поставщика — какие товары у него реально брали. */
export async function getProductPurchaseHistoryForSupplier(
  supplierId: string
): Promise<ProductPurchaseHistoryEntry[]> {
  const items = await prisma.batchItem.findMany({
    where: { supplierId },
    include: { product: true, batch: true },
    orderBy: { batch: { orderDate: "desc" } },
  });

  const map = new Map<string, ProductPurchaseHistoryEntry>();

  for (const item of items) {
    const existing = map.get(item.productId);
    if (!existing) {
      map.set(item.productId, {
        productId: item.productId,
        productSku: item.product.sku,
        productName: item.product.name,
        lastPriceRub: item.purchasePriceRub.toString(),
        lastOrderDate: item.batch.orderDate,
        totalQty: item.qty,
        shipmentsCount: 1,
      });
    } else {
      existing.totalQty += item.qty;
      existing.shipmentsCount += 1;
    }
  }

  return Array.from(map.values());
}
