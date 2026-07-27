import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import ProductForm from "../ProductForm";
import PhotoThumb from "../PhotoThumb";
import SupplierPricesSection from "../SupplierPricesSection";
import { getSupplierPurchaseHistoryForProduct } from "@/lib/supplierProductHistory";
import { EditIconLink } from "@/app/components/RowIconActions";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => EditProductPageContent(params));
}

async function EditProductPageContent(params: { id: string }) {
  const [product, costHistory, supplierPrices, suppliers, purchaseHistory, listings] =
    await Promise.all([
      prisma.product.findUnique({ where: { id: params.id } }),
      prisma.productCostHistory.findMany({
        where: { productId: params.id },
        orderBy: { changedAt: "desc" },
        include: { batchItem: { include: { batch: true } } },
      }),
      prisma.supplierPrice.findMany({
        where: { productId: params.id },
        include: { supplier: true },
        orderBy: { priceCny: "asc" },
      }),
      prisma.supplier.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      getSupplierPurchaseHistoryForProduct(params.id),
      prisma.mpListing.findMany({
        where: { productId: params.id },
        include: { marketplace: true },
        orderBy: { marketplace: { name: "asc" } },
      }),
    ]);
  if (!product) notFound();

  const pricedSupplierIds = new Set(supplierPrices.map((p) => p.supplierId));
  const purchaseOnlyHistory = purchaseHistory.filter(
    (h) => !pricedSupplierIds.has(h.supplierId)
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <PhotoThumb url={product.photoUrl} size={200} />
        <div>
          <h1 style={{ marginBottom: 4 }}>{product.name}</h1>
          <div className="muted">SKU: {product.sku}</div>
        </div>
      </div>

      <div
        style={{
          margin: "20px 0",
          background: "var(--surface)",
          padding: "12px 16px",
          borderRadius: 8,
          boxShadow: "0 1px 3px var(--shadow)",
          maxWidth: 400,
        }}
      >
        <div className="muted">Закупочная цена</div>
        <div style={{ fontSize: 20, fontWeight: 600 }}>
          {product.purchasePriceRub ? `${product.purchasePriceRub.toString()} ₽` : "не задана"}
        </div>
        <div className="muted" style={{ marginTop: 4 }}>
          Можно ввести вручную в форме ниже — но как только придёт поставка с
          указанной ценой за штуку, она всегда её заменит.
        </div>
      </div>

      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16 }}>Площадки</h2>
        {listings.length === 0 ? (
          <p className="muted">
            Товар пока не привязан ни к одной площадке — привязка появляется
            автоматически при сопоставлении на странице «Сопоставление».
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Площадка</th>
                  <th>Артикул на площадке</th>
                  <th>Цена, ₽</th>
                  <th>Комиссия, %</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id}>
                    <td>{l.marketplace.name}</td>
                    <td>{l.mpSku}</td>
                    <td>{l.currentPrice ? l.currentPrice.toString() : "—"}</td>
                    <td>{l.commissionPct.toString()}</td>
                    <td>
                      <EditIconLink href={`/mp-listings/${l.id}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {costHistory.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16 }}>История изменения закупочной цены</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Было → стало</th>
                  <th>Поставка</th>
                </tr>
              </thead>
              <tbody>
                {costHistory.map((h) => (
                  <tr key={h.id}>
                    <td>{h.changedAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                    <td>
                      {h.oldCost ? `${h.oldCost.toString()} ₽` : "—"} →{" "}
                      <strong>{h.newCost.toString()} ₽</strong>
                    </td>
                    <td>
                      {h.batchItem ? (
                        <a href={`/batches/${h.batchItem.batch.id}`}>
                          {h.batchItem.batch.batchNumber}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16 }}>Поставщики этого товара</h2>

        <SupplierPricesSection
          productId={product.id}
          suppliers={suppliers}
          mainSupplierId={product.supplierId}
          prices={supplierPrices.map((p) => ({
            id: p.id,
            supplierId: p.supplierId,
            supplierName: p.supplier.name,
            priceCny: p.priceCny.toString(),
            validFrom: p.validFrom.toISOString().slice(0, 10),
            validTo: p.validTo ? p.validTo.toISOString().slice(0, 10) : null,
            minQty: p.minQty,
          }))}
        />

        {purchaseOnlyHistory.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div className="muted">
              Закупали у (цена в прайс-лист не заводилась):
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Поставщик</th>
                    <th>Последняя цена, ₽/шт</th>
                    <th>Последняя закупка</th>
                    <th>Всего поставок</th>
                    <th>Всего штук</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOnlyHistory.map((h) => (
                    <tr key={h.supplierId}>
                      <td>
                        <a href={`/suppliers/${h.supplierId}`}>{h.supplierName}</a>
                        {h.supplierId === product.supplierId && (
                          <span className="muted"> · текущий поставщик</span>
                        )}
                      </td>
                      <td>{h.lastPriceRub}</td>
                      <td>{h.lastOrderDate.toISOString().slice(0, 10)}</td>
                      <td>{h.shipmentsCount}</td>
                      <td>{h.totalQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <ProductForm
        suppliers={suppliers}
        initial={{
          id: product.id,
          sku: product.sku,
          name: product.name,
          category: product.category ?? "",
          photoUrl: product.photoUrl ?? "",
          barcode: product.barcode ?? "",
          supplierId: product.supplierId ?? "",
          itemWeightG: product.itemWeightG.toString(),
          itemLengthMm: String(product.itemLengthMm),
          itemWidthMm: String(product.itemWidthMm),
          itemHeightMm: String(product.itemHeightMm),
          unitsPerBox: String(product.unitsPerBox),
          boxWeightKg: product.boxWeightKg.toString(),
          boxLengthMm: String(product.boxLengthMm),
          boxWidthMm: String(product.boxWidthMm),
          boxHeightMm: String(product.boxHeightMm),
          isActive: product.isActive,
          purchasePriceRub: product.purchasePriceRub ? product.purchasePriceRub.toString() : "",
          seasonalDemandMultiplier: product.seasonalDemandMultiplier.toString(),
        }}
      />
    </div>
  );
}
