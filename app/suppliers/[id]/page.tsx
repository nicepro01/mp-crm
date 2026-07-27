import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import SupplierForm from "../SupplierForm";
import { getProductPurchaseHistoryForSupplier } from "@/lib/supplierProductHistory";

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
  const [supplier, supplierPrices, purchaseHistory] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: params.id } }),
    prisma.supplierPrice.findMany({
      where: { supplierId: params.id },
      include: { product: true },
      orderBy: { product: { name: "asc" } },
    }),
    getProductPurchaseHistoryForSupplier(params.id),
  ]);
  if (!supplier) notFound();

  const pricedProductIds = new Set(supplierPrices.map((p) => p.productId));
  const purchaseOnlyHistory = purchaseHistory.filter(
    (h) => !pricedProductIds.has(h.productId)
  );

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
                  <th>Товар</th>
                  <th>Цена, CNY</th>
                  <th>Действует с</th>
                  <th>Действует по</th>
                  <th>Мин. партия</th>
                </tr>
              </thead>
              <tbody>
                {supplierPrices.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <a href={`/products/${p.productId}`}>
                        {p.product.sku} — {p.product.name}
                      </a>
                    </td>
                    <td>{p.priceCny.toString()}</td>
                    <td>{p.validFrom.toISOString().slice(0, 10)}</td>
                    <td>{p.validTo ? p.validTo.toISOString().slice(0, 10) : "—"}</td>
                    <td>{p.minQty ?? "—"}</td>
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
                    <th>Товар</th>
                    <th>Последняя цена, ₽/шт</th>
                    <th>Последняя закупка</th>
                    <th>Всего поставок</th>
                    <th>Всего штук</th>
                  </tr>
                </thead>
                <tbody>
                  {purchaseOnlyHistory.map((h) => (
                    <tr key={h.productId}>
                      <td>
                        <a href={`/products/${h.productId}`}>
                          {h.productSku} — {h.productName}
                        </a>
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
