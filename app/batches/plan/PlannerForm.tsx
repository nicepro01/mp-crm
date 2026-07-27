"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import PhotoThumb from "@/app/products/PhotoThumb";
import AnalyticsTabs from "@/app/analytics/AnalyticsTabs";
import { SortableTh } from "@/app/components/SortableTh";
import { useMultiSort } from "@/lib/useMultiSort";
import { compareForSort } from "@/lib/sortCompare";
import {
  PlannerRow,
  MarketplaceStat,
  SortKey,
  marketplaceLabels,
  columns,
  fmt,
  displayStats,
  sortRows,
  LOW_BUYBACK_THRESHOLD_PCT,
} from "./plannerShared";

type LineState = { selected: boolean; qty: string; qtyTouched: boolean; price: string };

type WarehouseStat = {
  warehouseName: string;
  qtyAvailable: number;
  avgDailySalesQty: number;
  recommendedOrderQty: number;
};

type WarehouseSortKey = keyof WarehouseStat;
const warehouseColumns: { key: WarehouseSortKey; label: string; type: "string" | "number" }[] = [
  { key: "warehouseName", label: "Склад", type: "string" },
  { key: "qtyAvailable", label: "Остаток", type: "number" },
  { key: "avgDailySalesQty", label: "Продаж/день", type: "number" },
  { key: "recommendedOrderQty", label: "Рекомендовано, шт", type: "number" },
];

export default function PlannerForm({
  rows,
  marketplaceStats,
  warehouseStatsByProduct,
}: {
  rows: PlannerRow[];
  marketplaceStats: Record<string, Record<string, MarketplaceStat>>;
  warehouseStatsByProduct: Record<string, Record<string, WarehouseStat[]>>;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.productId,
        {
          // Раньше тут было "selected: r.needsReorder" — автоматически
          // отмечало ВСЕ товары, которым пора заказывать, сразу по всем
          // площадкам и вкладкам (выбор общий для всех вкладок). Из-за
          // этого в поставку/выгрузку могло попасть в разы больше товаров,
          // чем реально отмечено вручную — небезопасно, когда речь о
          // реальном заказе. Теперь по умолчанию ничего не выбрано.
          selected: false,
          // Пока поле не редактировали руками, показываем и используем
          // "Рекомендовано" той вкладки, которую сейчас смотрим (см.
          // effectiveQty ниже) — здесь просто запасное значение на случай,
          // если понадобится вне контекста конкретной вкладки.
          qty: String(r.recommendedOrderQty),
          qtyTouched: false,
          price: r.purchasePriceRub !== null ? String(r.purchasePriceRub) : "",
        },
      ])
    )
  );
  const [batchNumber, setBatchNumber] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { pinned, sortKey, sortDir, handleSort, togglePin } = useMultiSort<SortKey>("daysOfStockLeft");
  // Разворот строки с разбивкой по складам — ключ включает код площадки,
  // т.к. одна и та же строка товара показывается на нескольких вкладках
  // (Общая + каждая площадка) одновременно, разворот у них независимый.
  const [expandedWarehouses, setExpandedWarehouses] = useState<Set<string>>(new Set());
  function toggleWarehouseExpanded(key: string) {
    setExpandedWarehouses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Сортировка внутри разворота по складам — одна на все развёрнутые
  // строки сразу (проще, чем помнить сортировку под каждый товар отдельно).
  const [whSortKey, setWhSortKey] = useState<WarehouseSortKey>("warehouseName");
  const [whSortDir, setWhSortDir] = useState<"asc" | "desc">("asc");
  function handleWhSort(key: WarehouseSortKey) {
    if (whSortKey === key) {
      setWhSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setWhSortKey(key);
      setWhSortDir("asc");
    }
  }
  function sortWarehouseStats(list: WarehouseStat[]): WarehouseStat[] {
    const col = warehouseColumns.find((c) => c.key === whSortKey)!;
    return [...list].sort((a, b) => compareForSort(a[whSortKey], b[whSortKey], col.type, whSortDir));
  }

  function setLine(productId: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [productId]: { ...prev[productId], ...patch } }));
  }

  // Пока пользователь не ввёл количество вручную, показываем и считаем
  // "Рекомендовано" той площадки, которую сейчас смотрим (statsOverride) —
  // так на вкладке WB видно WB-число, на Ozon — Ozon-число. Как только
  // тронули поле руками — дальше используется ровно то, что ввели, и оно
  // уже не меняется при переключении вкладок.
  function lineFor(r: PlannerRow, statsOverride?: Record<string, MarketplaceStat>) {
    const line = lines[r.productId];
    const qty = line.qtyTouched
      ? Number(line.qty) || 0
      : displayStats(r, statsOverride).recommendedOrderQty;
    const price = Number(line.price) || 0;
    return { line, qty, price };
  }

  function groupSubtotal(groupRows: PlannerRow[], statsOverride?: Record<string, MarketplaceStat>) {
    let count = 0;
    let sum = 0;
    let weightKg = 0;
    let volumeM3 = 0;
    let boxes = 0;
    for (const r of groupRows) {
      const { line, qty, price } = lineFor(r, statsOverride);
      if (!line.selected || qty <= 0) continue;
      count++;
      sum += qty * price;
      const boxesNeeded = Math.ceil(qty / r.unitsPerBox);
      boxes += boxesNeeded;
      weightKg += boxesNeeded * r.boxWeightKg;
      volumeM3 += boxesNeeded * r.boxVolumeM3;
    }
    return { count, sum, weightKg, volumeM3, boxes };
  }

  function renderTable(
    tabRows: PlannerRow[],
    statsOverride?: Record<string, MarketplaceStat>,
    marketplaceCode?: string
  ) {
    const sorted = sortRows(tabRows, sortKey, sortDir, statsOverride, pinned);
    const subtotal = groupSubtotal(sorted, statsOverride);
    const detailColSpan = columns.length + 7;
    return (
      <div style={{ marginTop: 16 }}>
        <div className="muted" style={{ marginBottom: 8 }}>
          выбрано {subtotal.count} · {fmt(subtotal.sum)} ₽ · {fmt(subtotal.weightKg)} кг · {fmt(subtotal.volumeM3)}{" "}
          м³ · {subtotal.boxes} кор.
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 20 }}></th>
                <th style={{ width: 24 }}></th>
                <th style={{ width: 50 }}></th>
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
                <th>Площадки</th>
                <th>Заказать, шт</th>
                <th>Цена закупки, ₽</th>
                <th>Сумма, ₽</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const { line, qty, price } = lineFor(r, statsOverride);
                const stats = displayStats(r, statsOverride);
                const critical =
                  stats.daysOfStockLeft !== null && stats.daysOfStockLeft <= r.leadTimeDays * 0.5;
                const warning = !critical && stats.needsReorder;
                const rowBg = critical
                  ? "rgba(239, 68, 68, 0.12)"
                  : warning
                  ? "rgba(245, 158, 11, 0.12)"
                  : undefined;
                const warehouseStats = marketplaceCode
                  ? warehouseStatsByProduct[marketplaceCode]?.[r.productId]
                  : undefined;
                const expandKey = `${marketplaceCode ?? "all"}|${r.productId}`;
                const isExpanded = expandedWarehouses.has(expandKey);
                return (
                  <Fragment key={r.productId}>
                  <tr style={{ background: rowBg }}>
                    <td>
                      {warehouseStats && warehouseStats.length > 0 && (
                        <button
                          type="button"
                          onClick={() => toggleWarehouseExpanded(expandKey)}
                          aria-label="Показать разбивку по складам"
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: 12,
                            padding: 0,
                            color: "var(--muted)",
                          }}
                        >
                          {isExpanded ? "▼" : "▶"}
                        </button>
                      )}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={line.selected}
                        onChange={(e) => setLine(r.productId, { selected: e.target.checked })}
                      />
                    </td>
                    <td>
                      <PhotoThumb url={r.photoUrl} size={88} />
                    </td>
                    <td>
                      {r.sku}
                      <div className="muted">{r.name}</div>
                    </td>
                    <td>{r.supplierName ?? "—"}</td>
                    <td>{stats.qtyAvailable}</td>
                    <td>{r.qtyInTransit || "—"}</td>
                    <td>{stats.avgDailySalesQty || "—"}</td>
                    <td>
                      {stats.daysOfStockLeft ?? "—"}
                      {critical && (
                        <div className="margin-negative" style={{ fontSize: 12 }}>
                          критично
                        </div>
                      )}
                      {warning && <div style={{ fontSize: 12, color: "#d97706" }}>скоро</div>}
                    </td>
                    <td>
                      {stats.daysOfStockLeftAfterArrival ?? "—"}
                      {r.qtyInTransit > 0 && (
                        <div className="muted" title="Учтена доля «в пути», распределённая на эту площадку пропорционально её нехватке">
                          +{stats.qtyInTransitAllocated} в пути
                        </div>
                      )}
                    </td>
                    <td>
                      {stats.recommendedOrderQty}
                      {r.seasonalDemandMultiplier !== 1 && (
                        <div
                          className="muted"
                          title={
                            r.seasonalFromHistory
                              ? "Посчитано по истории продаж товара за прошлые периоды"
                              : "Ручной коэффициент сезонного спроса из карточки товара"
                          }
                        >
                          ×{r.seasonalDemandMultiplier} сезон{r.seasonalFromHistory ? " (история)" : ""}
                        </div>
                      )}
                      {stats.moqApplied && (
                        <div
                          style={{ fontSize: 12, color: "#d97706" }}
                          title="Расчётная потребность была меньше минимальной партии поставщика — количество поднято до MOQ"
                        >
                          поднято до MOQ {r.moq}
                        </div>
                      )}
                      {r.buybackPct !== null && r.buybackPct < LOW_BUYBACK_THRESHOLD_PCT && (
                        <div
                          className="margin-negative"
                          style={{ fontSize: 12 }}
                          title="Высокая доля отказов/невыкупа на WB за последний период — прежде чем повторять заказ, проверьте фото/описание/размеры товара"
                        >
                          выкуп {r.buybackPct}% на WB
                        </div>
                      )}
                    </td>
                    <td>{r.marketplaces || "—"}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={qty}
                        onChange={(e) => setLine(r.productId, { qty: e.target.value, qtyTouched: true })}
                        style={{ width: 90 }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.price}
                        onChange={(e) => setLine(r.productId, { price: e.target.value })}
                        style={{ width: 100 }}
                      />
                    </td>
                    <td>{qty && price ? fmt(Math.round(qty * price * 100) / 100) : "—"}</td>
                  </tr>
                  {isExpanded && warehouseStats && (
                    <tr>
                      <td colSpan={detailColSpan} style={{ background: "var(--surface-alt)", padding: 12 }}>
                        <div className="muted" style={{ marginBottom: 6 }}>
                          Разбивка по складам — рекомендованное количество для этой площадки распределено пропорционально нехватке каждого склада
                        </div>
                        <table>
                          <thead>
                            <tr>
                              {warehouseColumns.map((col) => (
                                <th
                                  key={col.key}
                                  onClick={() => handleWhSort(col.key)}
                                  style={{ cursor: "pointer", userSelect: "none" }}
                                  title="Сортировать"
                                >
                                  {col.label}
                                  {whSortKey === col.key ? (whSortDir === "asc" ? " ▲" : " ▼") : ""}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sortWarehouseStats(warehouseStats).map((w) => (
                              <tr key={w.warehouseName}>
                                <td>{w.warehouseName}</td>
                                <td>{w.qtyAvailable}</td>
                                <td>{w.avgDailySalesQty || "—"}</td>
                                <td>{w.recommendedOrderQty || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const marketplaceCodesPresent = useMemo(
    () => [...new Set(rows.flatMap((r) => r.marketplaceCodes))].sort(),
    [rows]
  );

  const totals = useMemo(() => {
    const t = groupSubtotal(rows);
    return { count: t.count, sum: Math.round(t.sum * 100) / 100, weightKg: t.weightKg, volumeM3: t.volumeM3 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, lines]);

  function selectedItems() {
    return rows
      .filter((r) => lines[r.productId]?.selected)
      .map((r) => ({
        productId: r.productId,
        qty: Number(lines[r.productId].qty),
        purchasePriceRub: Number(lines[r.productId].price),
      }));
  }

  async function handleExport() {
    setError(null);
    const selectedRows = rows.filter((r) => lines[r.productId]?.selected);
    if (selectedRows.length === 0) {
      setError("Выберите хотя бы один товар для выгрузки");
      return;
    }

    // Для каждой площадки, где реально продаётся товар, берём "Рекомендовано"
    // именно по ней (та же цифра, что показана на вкладке площадки) — так
    // закупщик видит, сколько из общего количества уйдёт на каждый канал.
    const items = selectedRows.map((r) => {
      const marketplaceQty: Record<string, number> = {};
      for (const code of r.marketplaceCodes) {
        marketplaceQty[code] = displayStats(r, marketplaceStats[code]).recommendedOrderQty;
      }
      return {
        productId: r.productId,
        qty: Number(lines[r.productId].qty),
        purchasePriceRub: Number(lines[r.productId].price),
        marketplaceQty,
      };
    });

    setExporting(true);
    const res = await fetch("/api/batches/plan/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    setExporting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Не удалось выгрузить Excel");
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zakupka-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!batchNumber.trim()) {
      setError("Укажите номер поставки");
      return;
    }

    const items = selectedItems();

    if (items.length === 0) {
      setError("Выберите хотя бы один товар");
      return;
    }
    const badItem = items.find((i) => !i.qty || i.qty <= 0 || !i.purchasePriceRub || i.purchasePriceRub <= 0);
    if (badItem) {
      setError("У всех выбранных товаров должны быть заполнены количество и цена закупки больше нуля");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/batches/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchNumber, orderDate, items }),
    });
    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Не удалось создать поставку");
      return;
    }

    const body = await res.json();
    router.push(`/batches/${body.id}`);
  }

  const tabs = [
    { key: "all", label: `Общая (${rows.length})`, content: renderTable(rows) },
    ...marketplaceCodesPresent.map((code) => {
      const tabRows = rows.filter((r) => r.marketplaceCodes.includes(code));
      return {
        key: code,
        label: `${marketplaceLabels[code] ?? code} (${tabRows.length})`,
        content: renderTable(tabRows, marketplaceStats[code], code),
      };
    }),
  ];

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: "none" }}>
      <div className="row" style={{ maxWidth: 480 }}>
        <label>
          Номер поставки
          <input value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="напр. B-2026-07" />
        </label>
        <label>
          Дата заказа
          <input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
        </label>
      </div>

      <AnalyticsTabs tabs={tabs} />

      <div
        className="muted"
        style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span>
          Всего выбрано товаров: <strong>{totals.count}</strong> · общая сумма партии:{" "}
          <strong>{totals.sum.toLocaleString("ru-RU")} ₽</strong> · вес:{" "}
          <strong>{fmt(totals.weightKg)} кг</strong> · объём: <strong>{fmt(totals.volumeM3)} м³</strong>
        </span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="actions" style={{ marginTop: 16 }}>
        <button type="submit" className="btn" disabled={saving}>
          {saving ? "Создаю поставку…" : "Создать поставку"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleExport} disabled={exporting}>
          {exporting ? "Выгружаю…" : "Скачать Excel для закупщика"}
        </button>
      </div>
    </form>
  );
}
