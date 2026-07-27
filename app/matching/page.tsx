import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import MatchingImportForm from "./MatchingImportForm";
import MatchingRow from "./MatchingRow";
import BulkCreatePlaceholdersButton from "./BulkCreatePlaceholdersButton";
import PhotoThumb from "@/app/products/PhotoThumb";

export const dynamic = "force-dynamic";

const viaLabels: Record<string, string> = {
  mp_listing: "по листингу МП",
  barcode: "по штрихкоду",
  manual: "вручную",
  placeholder: "товар-заглушка",
};

export default async function MatchingPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => MatchingPageContent());
}

async function MatchingPageContent() {
  const [marketplaces, products, pendingItems, recentResolved] = await Promise.all([
    prisma.marketplace.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, photoUrl: true },
    }),
    prisma.mpImportItem.findMany({
      where: { status: "PENDING" },
      include: { marketplace: true },
      orderBy: { importedAt: "asc" },
    }),
    prisma.mpImportItem.findMany({
      where: { status: { in: ["MATCHED", "IGNORED"] } },
      include: { marketplace: true, matchedProduct: true },
      orderBy: { resolvedAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    // Full-bleed — эта страница вся состоит из широких таблиц (SKU/штрихкод/
    // название с площадки + селект товара), стандартная ширина main
    // (max-width: 1800px, см. globals.css) оставляла лишние поля по бокам на
    // широком экране. "Выламываемся" из центрирования main тем же приёмом,
    // что и обычный full-bleed блок: отрицательные márgin на всю ширину
    // вьюпорта, с тем же внутренним отступом, что и у main.
    <div style={{ maxWidth: "100vw", marginLeft: "calc(-50vw + 50%)", marginRight: "calc(-50vw + 50%)", padding: "0 24px" }}>
      <h1>Сопоставление товаров с площадками</h1>

      {marketplaces.length === 0 ? (
        <p className="error">Сначала добавьте хотя бы одну площадку.</p>
      ) : (
        <MatchingImportForm marketplaces={marketplaces} />
      )}

      <div className="toolbar">
        <h2 style={{ fontSize: 18 }}>
          Ждут сопоставления {pendingItems.length > 0 && `(${pendingItems.length})`}
        </h2>
      </div>

      {pendingItems.length === 0 ? (
        <p className="muted">
          Нет несопоставленных позиций. Запустите тестовый импорт выше, чтобы
          проверить логику.
        </p>
      ) : (
        <>
          <BulkCreatePlaceholdersButton count={pendingItems.length} />
          <div className="table-scroll" style={{ marginBottom: 32 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 96 }}>Фото</th>
                  <th>Площадка</th>
                  <th>Артикул МП</th>
                  <th>Штрихкод</th>
                  <th>Название с площадки</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {pendingItems.map((item) => (
                  <MatchingRow
                    key={item.id}
                    item={{
                      id: item.id,
                      mpSku: item.mpSku,
                      barcode: item.barcode,
                      name: item.name,
                      marketplaceName: item.marketplace.name,
                    }}
                    products={products}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {recentResolved.length > 0 && (
        <>
          <h2 style={{ fontSize: 16 }}>Недавно сопоставлено</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 96 }}>Фото</th>
                  <th>Площадка</th>
                  <th>Артикул МП</th>
                  <th>Статус</th>
                  <th>Товар</th>
                  <th>Как сопоставлено</th>
                </tr>
              </thead>
              <tbody>
                {recentResolved.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <PhotoThumb url={item.matchedProduct?.photoUrl ?? null} size={72} />
                    </td>
                    <td>{item.marketplace.name}</td>
                    <td style={{ fontSize: 16, fontWeight: 600 }}>{item.mpSku}</td>
                    <td>{item.status === "IGNORED" ? "Игнорируется" : "Сопоставлено"}</td>
                    <td>
                      {item.matchedProduct ? (
                        <>
                          <span style={{ fontSize: 16, fontWeight: 600 }}>{item.matchedProduct.sku}</span>
                          <div className="muted">{item.matchedProduct.name}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{item.matchedVia ? viaLabels[item.matchedVia] : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
