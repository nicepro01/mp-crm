import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import AnalyticsTabs from "../analytics/AnalyticsTabs";
import ProductsTable, { ProductRow } from "./ProductsTable";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => ProductsPageContent());
}

async function ProductsPageContent() {
  const [products, stockSums, inTransitSums, salesSums, listings] = await Promise.all([
    prisma.product.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.stock.groupBy({
      by: ["productId"],
      _sum: { qtyAvailable: true },
    }),
    prisma.batchItem.groupBy({
      by: ["productId"],
      where: { batch: { logisticsStatus: { not: "RECEIVED" } } },
      _sum: { qty: true },
    }),
    prisma.productStockAnalytics.groupBy({
      by: ["productId"],
      _sum: { avgDailySalesQty: true },
    }),
    prisma.mpListing.findMany({
      // Берём все листинги, включая архивные на конкретной площадке —
      // они всё равно должны попадать во вкладку этой площадки (просто
      // скрыты по умолчанию переключателем в таблице), иначе их негде
      // увидеть, кроме отдельной страницы «Площадки».
      select: {
        productId: true,
        mpSku: true,
        isActive: true,
        marketplaceId: true,
        marketplace: { select: { name: true } },
      },
    }),
  ]);

  const stockMap = new Map(
    stockSums.map((s) => [s.productId, s._sum.qtyAvailable ?? 0])
  );
  const inTransitMap = new Map(
    inTransitSums.map((s) => [s.productId, s._sum.qty ?? 0])
  );
  const salesMap = new Map(
    salesSums.map((s) => [s.productId, Number(s._sum.avgDailySalesQty ?? 0)])
  );

  const marketplacesByProduct = new Map<string, Set<string>>();
  // Отдельно — id товаров по каждой площадке, чтобы построить вкладки
  // Ozon/WB/Яндекс.Маркет ниже (только те площадки, где реально есть
  // листинги). Ключ — marketplaceId, а не code: два магазина одной площадки
  // (напр. Ozon и Ozon 2) имеют одинаковый code, и группировка по коду
  // схлопывала их в одну вкладку, перезаписывая название последним магазином.
  const productIdsByMarketplaceId = new Map<string, Set<string>>();
  const marketplaceNameById = new Map<string, string>();
  // Активен ли листинг именно на этой площадке (архив на WB не значит
  // архив на Ozon/ЯМ) — используется, чтобы скрывать архивные по
  // умолчанию внутри вкладки конкретной площадки, но не терять их совсем.
  const listingActiveByMarketplaceAndProduct = new Map<string, boolean>();
  // Один и тот же товар иногда сматчен дважды под разными артикулами на
  // одной площадке (опечатка/другой вид дефиса/старое название из другого
  // отчёта) — группируем по (площадка, товар), чтобы такие случаи показать
  // отдельно и не путать пользователя задвоенным числом.
  const listingsByMarketplaceAndProduct = new Map<string, { mpSku: string }[]>();
  for (const l of listings) {
    if (l.isActive) {
      const set = marketplacesByProduct.get(l.productId) ?? new Set<string>();
      set.add(l.marketplace.name);
      marketplacesByProduct.set(l.productId, set);
    }

    const marketplaceId = l.marketplaceId;
    marketplaceNameById.set(marketplaceId, l.marketplace.name);
    const idsSet = productIdsByMarketplaceId.get(marketplaceId) ?? new Set<string>();
    idsSet.add(l.productId);
    productIdsByMarketplaceId.set(marketplaceId, idsSet);

    const activeKey = `${marketplaceId}|${l.productId}`;
    listingActiveByMarketplaceAndProduct.set(
      activeKey,
      l.isActive || (listingActiveByMarketplaceAndProduct.get(activeKey) ?? false)
    );

    if (l.isActive) {
      const dupKey = `${marketplaceId}|${l.productId}`;
      const arr = listingsByMarketplaceAndProduct.get(dupKey) ?? [];
      arr.push({ mpSku: l.mpSku });
      listingsByMarketplaceAndProduct.set(dupKey, arr);
    }
  }

  const duplicateListings = [...listingsByMarketplaceAndProduct.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([dupKey, arr]) => {
      const [marketplaceId, productId] = dupKey.split("|");
      const product = products.find((p) => p.id === productId);
      return {
        marketplaceName: marketplaceNameById.get(marketplaceId) ?? marketplaceId,
        sku: product?.sku ?? productId,
        name: product?.name ?? "—",
        mpSkus: arr.map((a) => a.mpSku),
      };
    });

  const rows: ProductRow[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    photoUrl: p.photoUrl,
    isActive: p.isActive,
    costDisplay: p.purchasePriceRub ? `${p.purchasePriceRub.toString()} ₽` : null,
    costValue: p.purchasePriceRub ? Number(p.purchasePriceRub) : null,
    costTitle: p.purchasePriceRub
      ? "Закупочная цена — из последней поставки этого товара"
      : null,
    stockTotal: stockMap.get(p.id) ?? 0,
    inTransitTotal: inTransitMap.get(p.id) ?? 0,
    avgDailySalesQty: salesMap.get(p.id) ?? 0,
    marketplaces: [...(marketplacesByProduct.get(p.id) ?? [])].sort().join(", "),
  }));

  const marketplaceTabs = [...productIdsByMarketplaceId.entries()].map(([marketplaceId, ids]) => {
    const filteredRows = rows
      .filter((r) => ids.has(r.id))
      .map((r) => ({
        ...r,
        listingActive: listingActiveByMarketplaceAndProduct.get(`${marketplaceId}|${r.id}`) ?? true,
      }));
    // В счётчике вкладки показываем только активные (и глобально, и именно
    // на этой площадке) — так число совпадает с тем, что реально видно по
    // умолчанию (архивные скрыты переключателем внутри таблицы).
    const activeCount = filteredRows.filter((r) => r.isActive && r.listingActive).length;
    return {
      key: marketplaceId,
      label: `${marketplaceNameById.get(marketplaceId) ?? marketplaceId} (${activeCount})`,
      content: <ProductsTable products={filteredRows} />,
    };
  });

  return (
    <div>
      <div className="toolbar">
        <h1>Товары</h1>
        <a className="btn" href="/products/new">+ Новый товар</a>
      </div>

      {duplicateListings.length > 0 && (
        <div
          className="muted"
          style={{
            background: "#fef3c7",
            color: "#92400e",
            padding: "10px 12px",
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <strong>Задвоенные листинги ({duplicateListings.length}):</strong> один товар
          сматчен под несколько разных артикулов на одной площадке — вероятно,
          опечатка или старое название из другого отчёта. Проверьте на{" "}
          <a href="/mp-listings">странице «Площадки»</a> и удалите лишний.
          <ul style={{ marginTop: 6, marginBottom: 0 }}>
            {duplicateListings.map((d, i) => (
              <li key={i}>
                {d.marketplaceName} — {d.sku} ({d.name.slice(0, 40)}):{" "}
                {d.mpSkus.map((s) => `«${s}»`).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AnalyticsTabs
        tabs={[
          {
            key: "all",
            label: `Все товары (${rows.filter((r) => r.isActive).length})`,
            content: <ProductsTable products={rows} />,
          },
          ...marketplaceTabs,
        ]}
      />
    </div>
  );
}
