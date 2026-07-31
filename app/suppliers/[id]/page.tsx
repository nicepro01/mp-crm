import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import SupplierForm from "../SupplierForm";
import { getProductPurchaseHistoryForSupplier } from "@/lib/supplierProductHistory";
import PhotoThumb from "@/app/products/PhotoThumb";

export const dynamic = "force-dynamic";

export default async function EditSupplierPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => EditSupplierPageContent(params));
}

async function EditSupplierPageContent(params: { id: string }) {
  const [supplier, supplierPrices, purchaseHistory, mainSupplierProducts] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: params.id } }),
    prisma.supplierPrice.findMany({
      where: { supplierId: params.id },
      include: { product: true },
      orderBy: { product: { name: "asc" } },
    }),
    getProductPurchaseHistoryForSupplier(params.id),
    // Товары, где поставщик указан "основным" на карточке (см. Product.supplierId)
    // — это просто заполняет поле при оформлении новой поставки, реальной
    // закупки/прайса может ещё не быть, но пользователю нужно видеть сам факт
    // привязки, а не только историю уже случившихся поставок.
    prisma.product.findMany({
      where: { supplierId: params.id },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!supplier) notFound();

  const pricedProductIds = new Set(supplierPrices.map((p) => p.productId));
  const purchaseOnlyHistory = purchaseHistory.filter(
    (h) => !pricedProductIds.has(h.productId)
  );
  const historyProductIds = new Set(purchaseHistory.map((h) => h.productId));
  const unorderedMainSupplierProducts = mainSupplierProducts.filter(
    (p) => !pricedProductIds.has(p.id) && !historyProductIds.has(p.id)
  );

  // Фото/остаток/в пути/остаток по площадкам — общие для всех трёх списков
  // выше, считаем один раз по объединённому набору товаров.
  const allProductIds = [
    ...new Set([
      ...supplierPrices.map((p) => p.productId),
      ...purchaseHistory.map((h) => h.productId),
      ...mainSupplierProducts.map((p) => p.id),
    ]),
  ];

  const [photoRows, stockSums, inTransitSums, marketplaceStockRows] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: allProductIds } }, select: { id: true, photoUrl: true } }),
    prisma.stock.groupBy({
      by: ["productId"],
      where: { productId: { in: allProductIds } },
      _sum: { qtyAvailable: true },
    }),
    prisma.batchItem.groupBy({
      by: ["productId"],
      where: { productId: { in: allProductIds }, batch: { logisticsStatus: { not: "RECEIVED" } } },
      _sum: { qty: true },
    }),
    prisma.productStockAnalytics.findMany({
      where: { productId: { in: allProductIds } },
      include: { marketplace: { select: { name: true } } },
    }),
  ]);

  const photoByProduct = new Map(photoRows.map((p) => [p.id, p.photoUrl]));
  const stockByProduct = new Map(stockSums.map((s) => [s.productId, s._sum.qtyAvailable ?? 0]));
  const inTransitByProduct = new Map(inTransitSums.map((s) => [s.productId, s._sum.qty ?? 0]));

  // marketplaceId, а не code — два магазина одной площадки (Ozon/Ozon 2)
  // должны показываться отдельными колонками, а не суммироваться в одну.
  const marketplaceNameById = new Map<string, string>();
  const marketplaceStockByProduct = new Map<string, Map<string, number>>();
  for (const r of marketplaceStockRows) {
    marketplaceNameById.set(r.marketplaceId, r.marketplace.name);
    const m = marketplaceStockByProduct.get(r.productId) ?? new Map<string, number>();
    m.set(r.marketplaceId, (m.get(r.marketplaceId) ?? 0) + r.qtyAvailable);
    marketplaceStockByProduct.set(r.productId, m);
  }
  const marketplaceIdsPresent = [...marketplaceNameById.keys()].sort((a, b) =>
    marketplaceNameById.get(a)!.localeCompare(marketplaceNameById.get(b)!, "ru")
  );

  function renderPhotoCell(productId: string) {
    return (
      <td>
        <PhotoThumb url={photoByProduct.get(productId) ?? null} size={48} />
      </td>
    );
  }

  function renderStockCells(productId: string) {
    const byMarketplace = marketplaceStockByProduct.get(productId);
    return (
      <>
        <td>{stockByProduct.get(productId) ?? 0}</td>
        <td>{inTransitByProduct.get(productId) || "—"}</td>
        {marketplaceIdsPresent.map((mpId) => (
          <td key={mpId}>{byMarketplace?.get(mpId) ?? "—"}</td>
        ))}
      </>
    );
  }

  function stockHeaderCells() {
    return (
      <>
        <th>Остаток</th>
        <th>В пути</th>
        {marketplaceIdsPresent.map((mpId) => (
          <th key={mpId}>{marketplaceNameById.get(mpId)}</th>
        ))}
      </>
    );
  }

  return (
    <div>
      <h1>Редактирование поставщика</h1>

      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16 }}>Товары, которые мы у него закупаем</h2>

        {supplierPrices.length === 0 ? (
          <p className="muted">Цен в прайс-листе от этого поставщика ещё нет.</p>
        ) : (
          <div className="table-scroll" style={{ marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Товар</th>
                  <th>Цена, CNY</th>
                  <th>Действует с</th>
                  <th>Действует по</th>
                  <th>Мин. партия</th>
                  {stockHeaderCells()}
                </tr>
              </thead>
              <tbody>
                {supplierPrices.map((p) => (
                  <tr key={p.id}>
                    {renderPhotoCell(p.productId)}
                    <td>
                      <a href={`/products/${p.productId}`}>
                        {p.product.sku} — {p.product.name}
                      </a>
                    </td>
                    <td>{p.priceCny.toString()}</td>
                    <td>{p.validFrom.toISOString().slice(0, 10)}</td>
                    <td>{p.validTo ? p.validTo.toISOString().slice(0, 10) : "—"}</td>
                    <td>{p.minQty ?? "—"}</td>
                    {renderStockCells(p.productId)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {purchaseOnlyHistory.length > 0 && (
          <div>
            <div className="muted">
              Закупали (цена в прайс-лист не заводилась):
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Товар</th>
                    <th>Последняя цена, ₽/шт</th>
                    <th>Последняя закупка</th>
                    <th>Всего поставок</th>
                    <th>Всего штук</th>
                    {stockHeaderCells()}
                  </tr>
                </thead>
                <tbody>
                  {purchaseOnlyHistory.map((h) => (
                    <tr key={h.productId}>
                      {renderPhotoCell(h.productId)}
                      <td>
                        <a href={`/products/${h.productId}`}>
                          {h.productSku} — {h.productName}
                        </a>
                      </td>
                      <td>{h.lastPriceRub}</td>
                      <td>{h.lastOrderDate.toISOString().slice(0, 10)}</td>
                      <td>{h.shipmentsCount}</td>
                      <td>{h.totalQty}</td>
                      {renderStockCells(h.productId)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {unorderedMainSupplierProducts.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="muted">
              Указан основным поставщиком на карточке (поставок ещё не было):
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Товар</th>
                    {stockHeaderCells()}
                  </tr>
                </thead>
                <tbody>
                  {unorderedMainSupplierProducts.map((p) => (
                    <tr key={p.id}>
                      {renderPhotoCell(p.id)}
                      <td>
                        <a href={`/products/${p.id}`}>
                          {p.sku} — {p.name}
                        </a>
                      </td>
                      {renderStockCells(p.id)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <SupplierForm
        initial={{
          id: supplier.id,
          name: supplier.name,
          contactInfo: supplier.contactInfo ?? "",
          paymentTerms: supplier.paymentTerms ?? "",
          moq: supplier.moq === null ? "" : String(supplier.moq),
          leadTimeDays:
            supplier.leadTimeDays === null ? "" : String(supplier.leadTimeDays),
          rating: supplier.rating === null ? "" : String(supplier.rating),
          notes: supplier.notes ?? "",
        }}
      />
    </div>
  );
}
