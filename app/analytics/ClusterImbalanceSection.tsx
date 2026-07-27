"use client";

import PhotoThumb from "@/app/products/PhotoThumb";
import { SortableTh } from "@/app/components/SortableTh";
import { useMultiSort, applyMultiSort } from "@/lib/useMultiSort";
import { compareForSort } from "@/lib/sortCompare";

export type ClusterAnalyticsRow = {
  id: string;
  productId: string;
  clusterName: string;
  qtyAvailable: number;
  avgDailySalesQty: number;
  daysOfStockLeft: number | null;
  liquidityStatus: string | null;
  product: { sku: string; name: string; photoUrl: string | null } | null;
};

const DEFICIT_STATUSES = new Set(["Дефицитный", "Был дефицитный"]);
const EXCESS_STATUSES = new Set(["Избыточный"]);
const statusColors: Record<string, string> = {
  "Дефицитный": "#b91c1c",
  "Был дефицитный": "#b91c1c",
  "Избыточный": "#a16207",
};

type ClusterSortKey = "clusterName" | "qtyAvailable" | "avgDailySalesQty" | "daysOfStockLeft" | "liquidityStatus";

const clusterColumns: { key: ClusterSortKey; label: string; type: "string" | "number"; description: string }[] = [
  { key: "clusterName", label: "Регион", type: "string", description: "Город/склад площадки" },
  { key: "qtyAvailable", label: "Остаток", type: "number", description: "Текущий остаток на этом складе" },
  { key: "avgDailySalesQty", label: "Продаж/день", type: "number", description: "Средняя скорость продаж именно с этого склада" },
  { key: "daysOfStockLeft", label: "Дней до конца", type: "number", description: "Остаток ÷ продаж/день — на сколько дней хватит именно здесь" },
  {
    key: "liquidityStatus",
    label: "Статус",
    type: "string",
    description: "Дефицит — не хватает остатка под спрос; избыток — остатка больше, чем нужно, можно перераспределить",
  },
];

// Таблица складов одного товара — своя (независимая от других карточек)
// сортировка по клику на заголовок, тот же компонент/паттерн, что и везде
// в приложении (SortableTh + useMultiSort).
function ProductClusterTable({ clusters, bestId }: { clusters: ClusterAnalyticsRow[]; bestId: string }) {
  const { pinned, sortKey, sortDir, handleSort, togglePin } = useMultiSort<ClusterSortKey>(
    "avgDailySalesQty",
    "desc"
  );

  const sorted = applyMultiSort(
    clusters,
    (a, b, key, dir) => {
      const col = clusterColumns.find((c) => c.key === key);
      return compareForSort(a[key], b[key], col?.type, dir);
    },
    pinned,
    sortKey,
    sortDir
  );

  return (
    <table>
      <thead>
        <tr>
          {clusterColumns.map((col) => {
            const isPinned = pinned?.key === col.key;
            const active = isPinned || sortKey === col.key;
            const dir = isPinned ? pinned!.dir : sortDir;
            return (
              <SortableTh
                key={col.key}
                label={col.label}
                active={active}
                dir={dir}
                pinned={isPinned}
                onSort={() => handleSort(col.key)}
                onTogglePin={() => togglePin(col.key)}
                description={col.description}
              />
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((c) => (
          <tr key={c.id} style={c.id === bestId ? { fontWeight: 600 } : undefined}>
            <td>{c.clusterName}</td>
            <td>{c.qtyAvailable}</td>
            <td>{c.avgDailySalesQty}</td>
            <td>{c.daysOfStockLeft ?? "—"}</td>
            <td>
              {c.liquidityStatus ? (
                <span style={{ color: statusColors[c.liquidityStatus] ?? "var(--fg)" }}>{c.liquidityStatus}</span>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ClusterImbalanceSection({
  rows,
  estimatedStatus = false,
  periodNote,
}: {
  rows: ClusterAnalyticsRow[];
  // WB/Яндекс не отдают готовую категоризацию склада (дефицит/избыток), как
  // Ozon в отчёте «Оборачиваемость» — статус там посчитан нами по остатку и
  // скорости продаж (см. classifyLiquidity в app/analytics/page.tsx), а не
  // получен от площадки. Показываем оговорку, чтобы не выдавать оценку за факт.
  estimatedStatus?: boolean;
  /** За какой период посчитана скорость продаж — разное у Ozon (ручной отчёт) и WB/Яндекса (API). */
  periodNote?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="muted">
        Пока нет данных по складам этой площадки.
      </p>
    );
  }

  const byProduct = new Map<string, ClusterAnalyticsRow[]>();
  for (const row of rows) {
    const list = byProduct.get(row.productId) ?? [];
    list.push(row);
    byProduct.set(row.productId, list);
  }

  // Одна карточка на товар — сразу всё: лучший регион (где реально хорошо
  // продаётся), полная разбивка продаж/день по всем складам (сортируемая по
  // клику на заголовок), и подсветка дефицита/избытка прямо в этой же
  // таблице (не отдельными блоками).
  const products = [...byProduct.entries()]
    .map(([productId, clusters]) => {
      const best = [...clusters].sort((a, b) => b.avgDailySalesQty - a.avgDailySalesQty)[0];
      const totalSales = clusters.reduce((sum, c) => sum + c.avgDailySalesQty, 0);
      const sharePct = totalSales > 0 ? Math.round((best.avgDailySalesQty / totalSales) * 1000) / 10 : null;
      const hasImbalance =
        clusters.some((c) => c.liquidityStatus && DEFICIT_STATUSES.has(c.liquidityStatus)) &&
        clusters.some((c) => c.liquidityStatus && EXCESS_STATUSES.has(c.liquidityStatus));
      return { productId, product: clusters[0].product, clusters, best, sharePct, hasImbalance };
    })
    .sort((a, b) => b.best.avgDailySalesQty - a.best.avgDailySalesQty);

  return (
    <div>
      <p className="muted">
        По каждому товару — все склады/города площадки сразу: лучший регион
        (где реально хорошо продаётся) и продажи/день по остальным. Красным —
        дефицит (не хватает остатка под спрос), жёлтым — избыток (можно
        перераспределить между складами, не дожидаясь месяц новую партию из
        Китая). Заголовки таблицы внутри каждой карточки кликабельны —
        сортируют её отдельно от остальных.
        {estimatedStatus && (
          <>
            {" "}
            Статус (дефицит/избыток) здесь — наша оценка по остатку и скорости
            продаж, площадка не отдаёт готовую категоризацию по складам (в
            отличие от Ozon).
          </>
        )}
        {periodNote && (
          <>
            {" "}
            {periodNote}
          </>
        )}
      </p>

      {products.map(({ productId, product, clusters, best, sharePct, hasImbalance }) => (
        <div
          key={productId}
          style={{
            border: hasImbalance ? "1px solid #a16207" : "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <PhotoThumb url={product?.photoUrl ?? null} size={88} />
            <div>
              <div style={{ fontWeight: 600 }}>
                {product?.sku ?? "—"} — {product?.name ?? "—"}
                {hasImbalance && (
                  <span style={{ color: "#a16207", fontWeight: 600, marginLeft: 8, fontSize: 13 }}>
                    ⚠ перекос между складами
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                Лучший регион: <strong style={{ color: "var(--fg)" }}>{best.clusterName}</strong> —{" "}
                {best.avgDailySalesQty} шт/день
                {sharePct !== null && ` (${sharePct}% всех продаж товара)`}
              </div>
            </div>
          </div>
          <ProductClusterTable clusters={clusters} bestId={best.id} />
        </div>
      ))}
    </div>
  );
}
