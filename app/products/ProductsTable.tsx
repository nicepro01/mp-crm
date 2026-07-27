"use client";

import { useMemo, useState } from "react";
import PhotoThumb from "./PhotoThumb";
import { EditIconLink, DeleteIconButton } from "@/app/components/RowIconActions";
import { SortableTh } from "@/app/components/SortableTh";
import { useMultiSort, applyMultiSort } from "@/lib/useMultiSort";
import { compareForSort } from "@/lib/sortCompare";

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  photoUrl: string | null;
  isActive: boolean;
  costDisplay: string | null;
  costValue: number | null;
  costTitle: string | null;
  stockTotal: number;
  inTransitTotal: number;
  avgDailySalesQty: number;
  marketplaces: string;
  // Активен ли листинг именно на текущей площадке — задаётся только
  // внутри вкладки конкретного маркетплейса (WB/Ozon/ЯМ), на вкладке
  // "Все товары" не применяется (undefined).
  listingActive?: boolean;
};

type SortKey = "sku" | "name" | "costValue" | "stockTotal" | "inTransitTotal" | "avgDailySalesQty" | "marketplaces";

const columns: { key: SortKey; label: string; type: "string" | "number" }[] = [
  { key: "sku", label: "SKU", type: "string" },
  { key: "name", label: "Название", type: "string" },
  { key: "costValue", label: "Закупочная цена", type: "number" },
  { key: "stockTotal", label: "Остаток", type: "number" },
  { key: "inTransitTotal", label: "В пути", type: "number" },
  { key: "avgDailySalesQty", label: "Продаж/день", type: "number" },
  { key: "marketplaces", label: "Площадки", type: "string" },
];

export default function ProductsTable({ products }: { products: ProductRow[] }) {
  const [search, setSearch] = useState("");
  // Раньше было 2 отдельных чекбокса ("снятые с продажи" и "архивные на
  // площадке") — по сути одно и то же с точки зрения пользователя ("товар
  // не активен, не показывать среди рабочих"), просто 2 разных источника
  // признака (сам товар выключен целиком / выключен только листинг на этой
  // площадке). Объединили в один "Архив" — не чекбокс-фильтр поверх той же
  // таблицы, а отдельный проваливающийся вид с кнопкой "назад".
  const [view, setView] = useState<"active" | "archive">("active");
  const { pinned, sortKey, sortDir, handleSort, togglePin } = useMultiSort<SortKey>("sku");

  const archivedCount = useMemo(
    () => products.filter((p) => !p.isActive || p.listingActive === false).length,
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result = products.filter((p) => {
      const isArchived = !p.isActive || p.listingActive === false;
      if (view === "archive" ? !isArchived : isArchived) return false;
      if (!q) return true;
      return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
    });

    return applyMultiSort(
      result,
      (a, b, key, dir) => {
        const col = columns.find((c) => c.key === key);
        return compareForSort(a[key], b[key], col?.type, dir);
      },
      pinned,
      sortKey,
      sortDir
    );
  }, [products, search, view, sortKey, sortDir, pinned]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <input
          type="search"
          placeholder="Поиск по названию или SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        {view === "active" ? (
          archivedCount > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => setView("archive")}>
              Архив ({archivedCount})
            </button>
          )
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setView("active")}>
            ← Назад к активным
          </button>
        )}
      </div>

      {view === "archive" && (
        <p className="muted" style={{ marginTop: -8, marginBottom: 16 }}>
          Товары, снятые с продажи целиком, или архивные только на одной из площадок.
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="muted">
          {view === "archive" ? "В архиве пусто." : products.length === 0 ? "Пока нет ни одного товара." : "Ничего не найдено."}
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 108 }}></th>
                {columns.map((col) => {
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
                    />
                  );
                })}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} style={{ opacity: p.listingActive === false ? 0.55 : 1 }}>
                  <td>
                    <PhotoThumb url={p.photoUrl} size={88} />
                  </td>
                  <td>
                    {p.sku}
                    {p.listingActive === false && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        архив на площадке
                      </div>
                    )}
                  </td>
                  <td>{p.name}</td>
                  <td title={p.costTitle ?? undefined}>{p.costDisplay ?? "—"}</td>
                  <td>{p.stockTotal}</td>
                  <td>{p.inTransitTotal || "—"}</td>
                  <td>{p.avgDailySalesQty ? p.avgDailySalesQty.toFixed(2) : "—"}</td>
                  <td>{p.marketplaces || "—"}</td>
                  <td className="row-actions">
                    <EditIconLink href={`/products/${p.id}`} />
                    <DeleteIconButton
                      endpoint={`/api/products/${p.id}`}
                      confirmMessage="Удалить этот товар?"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
