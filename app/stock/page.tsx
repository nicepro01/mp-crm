import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { ensureWarehousesSeeded } from "@/lib/warehouseSeed";
import StockTable from "./StockTable";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => StockPageContent());
}

async function StockPageContent() {
  await ensureWarehousesSeeded();

  const [products, warehouses, stock] = await Promise.all([
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true, photoUrl: true },
    }),
    prisma.warehouse.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.stock.findMany(),
  ]);

  const stockRows = stock.map((s) => ({
    productId: s.productId,
    warehouseId: s.warehouseId,
    qtyAvailable: s.qtyAvailable,
    qtyReserved: s.qtyReserved,
    qtyInTransit: s.qtyInTransit,
  }));

  return (
    <div>
      <div className="toolbar">
        <h1>Остатки</h1>
        <a className="btn" href="/stock-import">Импорт из CSV</a>
      </div>

      <p className="muted">
        Клик по ячейке — ручная корректировка количества (доступно / в
        резерве / в пути). Массово — через «Импорт из CSV» из выгрузки
        площадки, пока без прямого API-синка. Заголовки столбцов кликабельны
        — сортируют таблицу.
      </p>

      {products.length === 0 ? (
        <p className="muted">Сначала добавьте хотя бы один товар.</p>
      ) : warehouses.length === 0 ? (
        <p className="muted">Нет ни одного склада.</p>
      ) : (
        <div className="table-scroll">
          <StockTable products={products} warehouses={warehouses} stock={stockRows} />
        </div>
      )}
    </div>
  );
}
