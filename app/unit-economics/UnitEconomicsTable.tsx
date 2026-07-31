"use client";

import { Fragment, useMemo, useState } from "react";
import { compareForSort } from "@/lib/sortCompare";
import { EditIconLink, DeleteIconButton } from "@/app/components/RowIconActions";
import { SortableTh } from "@/app/components/SortableTh";
import { useMultiSort, applyMultiSort } from "@/lib/useMultiSort";
import PhotoThumb from "@/app/products/PhotoThumb";

export type UnitEconomicsRow = {
  id: string;
  sku: string;
  name: string;
  photoUrl: string | null;
  marketplaceLabel: string;
  // ID конкретного магазина этой строки (null — строка уже сама агрегат
  // "Общая"/заглушка без данных). Нужен, чтобы на вкладке "Общая" построить
  // payoutByMarketplace ниже — там agg.marketplaceId не совпадает 1:1 с
  // отображаемым marketplaceLabel (тот может быть склеен из нескольких).
  marketplaceId?: string | null;
  period: string;
  cogsRub: number;
  mpCommissionRub: number;
  mpCommissionPct: number | null;
  mpLogisticsRub: number;
  sellPriceRub: number;
  netMarginRub: number;
  netMarginPct: number;
  // ROI = прибыль с 1 шт / себестоимость × 100 — отдача на вложенный в
  // закупку рубль (в отличие от netMarginPct, который считается от выручки).
  // null, если себестоимость не задана — делить не на что.
  roiPct: number | null;
  // Профит = payoutRub × (1 − 6%) − cogsRub — выплата от площадки за
  // вычетом налога УСН «доходы» (6% берётся с самой выплаты, не с полной
  // цены продажи — так фактически платится налог при таком раскладе) и
  // себестоимости. Null, если выплата ещё не посчитана (нет ue-записи).
  profitRub: number | null;
  avgDailySalesQty: number;
  stockQty: number;
  profitPerDayRub: number;
  // Уходит в развёрнутую детализацию — не показываем в основной таблице,
  // чтобы всё помещалось на экране без горизонтального скролла.
  inboundLogisticsRub: number;
  acquiringRub: number | null;
  reverseLogisticsRub: number | null;
  // ОЦЕНКА (не факт): доля расходов площадки без привязки к товару (у Ozon —
  // гл. образом реклама без sku), разнесённая пропорционально выручке.
  allocatedOverheadRub: number | null;
  storageRub: number;
  otherFeesRub: number | null;
  adsRub: number;
  taxRub: number;
  laborAllocRub: number;
  buybackPct: number | null;
  returnsQty: number;
  payoutRub: number | null;
  // Выплата от каждого конкретного магазина по этому товару — источник для
  // колонки "Выплата" (см. payoutMarketplaces на UnitEconomicsTable). На
  // "Общей" показываются сразу все магазины (вместо одного взвешенного
  // среднего payoutRub выше), на вкладке одного магазина — только он сам.
  // Ключ — marketplaceId (не код) — различает два магазина одной площадки.
  payoutByMarketplace?: Record<string, number | null>;
  // Всё остальное из исходного файла/API — то, что не поместилось в типовые
  // поля выше, но тоже реальные расходы/параметры расчёта. Ключи разные в
  // зависимости от источника (Ozon-файл / WB-файл / WB API) — см.
  // DETAILS_LABELS ниже, неизвестные ключи всё равно показываем как есть.
  details?: Record<string, unknown> | null;
  // Товар активен и выставлен на площадке, но за период не было ни одной
  // продажи — синк юнит-экономики такие товары пропускает (не с чего считать
  // среднее), поэтому строка не расчёт, а просто заглушка-напоминание.
  noSales?: boolean;
};

const DETAILS_LABELS: Record<string, { label: string; suffix?: string }> = {
  batchQty: { label: "Кол-во в партии, шт" },
  purchasePriceRubFromFile: { label: "Цена закупки (из файла), ₽" },
  volumeL: { label: "Объём, л" },
  lengthCm: { label: "Длина, см" },
  widthCm: { label: "Ширина, см" },
  heightCm: { label: "Высота, см" },
  supplyCluster: { label: "Кластер поставки" },
  deliveryCluster: { label: "Кластер доставки" },
  baseTariffRub: { label: "Базовый тариф логистики, ₽" },
  markupRub: { label: "Наценка логистики, ₽" },
  fbsHandlingRub: { label: "Обработка FBS, ₽" },
  deliveryHandoutRub: { label: "Выдача заказа, ₽" },
  totalDeliveryLogisticsRub: { label: "Логистика доставки итого, ₽" },
  returnLogisticsRub: { label: "Логистика возврата, ₽" },
  logisticsPctOfRevenue: { label: "Логистика, % от выручки", suffix: "%" },
  otherFeesPct: { label: "Другие услуги, %", suffix: "%" },
  totalOzonDeductionsRub: { label: "Удержания Ozon итого, ₽" },
  totalOzonDeductionsPct: { label: "Удержания Ozon, %", suffix: "%" },
  coInvestPct: { label: "Софинанс. скидки, %", suffix: "%" },
  taxSystem: { label: "Система налогообложения" },
  taxRatePct: { label: "Ставка налога, %", suffix: "%" },
  revenueRub: { label: "Выручка, ₽" },
  vatPct: { label: "НДС, %", suffix: "%" },
  vatRub: { label: "НДС, ₽" },
  taxBaseRub: { label: "Налоговая база, ₽" },
  taxAmountRub: { label: "Налог (А)УСН, ₽" },
  taxPctOfRevenue: { label: "Налог, % от выручки", suffix: "%" },
  profitPerBatchRub: { label: "Прибыль на партию, ₽" },
  roiPct: { label: "ROI, %", suffix: "%" },
  batchCommissionPct: { label: "Комиссия на закупку, %", suffix: "%" },
  batchCommissionRub: { label: "Комиссия на закупку, ₽" },
  batchCostRub: { label: "Стоимость партии, ₽" },
  expensesPerUnitRub: { label: "Расходы на ед. товара, ₽" },
  expensesPerBatchRub: { label: "Расходы на партию, ₽" },
  batchCostAfterShipmentRub: { label: "Стоимость партии после отгрузки, ₽" },
  extraLitersRub: { label: "Доп. литры, ₽" },
  baseLogisticsRub: { label: "Базовая логистика, ₽" },
  fbsAcceptanceRub: { label: "Приёмка FBS, ₽" },
  warehouseLogisticsCoef: { label: "Коэфф. логистики склада" },
  localizationIndex: { label: "Индекс локализации" },
  salesDistributionIndex: { label: "Индекс распределения продаж" },
  deliveryCostRub: { label: "Стоимость доставки, ₽" },
  totalLogisticsRub: { label: "Логистика итого, ₽" },
  adSpendPct: { label: "Реклама, % от цены", suffix: "%" },
  warehouseAcceptanceCoef: { label: "Коэфф. приёмки склада" },
  paidAcceptanceRub: { label: "Платная приёмка, ₽" },
  totalWbDeductionsRub: { label: "Удержания WB итого, ₽" },
  totalWbDeductionsPct: { label: "Удержания WB, %", suffix: "%" },
  sppPct: { label: "СПП, %", suffix: "%" },
  priceWithSppRub: { label: "Цена с СПП, ₽" },
  usnTaxRub: { label: "Налог УСН, ₽" },
  totalTaxPct: { label: "Налоги, % от выручки", suffix: "%" },
  totalCostPerUnitRub: { label: "Всего затрат на единицу, ₽" },
  quantitySold: { label: "Продано за период, шт" },
  windowDays: { label: "Период расчёта, дней" },
  source: { label: "Источник данных" },
  buyoutOrdersTotal: { label: "Заказов учтено для % выкупа, шт" },
  buyoutOrdersCancelled: { label: "Из них отменено/не выкуплено, шт" },
  buyoutWindowDays: { label: "Окно заказов для % выкупа, дней" },
  buyoutLagDays: { label: "Лаг ожидания исхода заказа, дней" },
};

function formatDetailValue(value: unknown): string {
  if (typeof value === "number") return String(Math.round(value * 100) / 100);
  return String(value);
}

type SortKey =
  | "sku"
  | "name"
  | "cogsRub"
  | "mpCommissionPct"
  | "mpLogisticsRub"
  | "sellPriceRub"
  | "netMarginRub"
  | "netMarginPct"
  | "roiPct"
  | "profitRub"
  | "buybackPct"
  | "returnsQty"
  | "allocatedOverheadRub"
  | "avgDailySalesQty"
  | "stockQty"
  | "profitPerDayRub";

// Явная ширина каждой колонки (px) — вместе с table-dense (см. globals.css)
// заставляет таблицу уложиться в ширину экрана без горизонтального скролла,
// даже с полутора десятками колонок (как на "Общей", где ещё добавляются
// колонки "Выплата" по каждой площадке — см. payoutMarketplaceCodes).
const columns: { key: SortKey; label: string; type: "string" | "number"; description: string; width: number }[] = [
  { key: "sku", label: "Товар", type: "string", description: "Артикул/SKU и название товара", width: 150 },
  {
    key: "cogsRub",
    label: "Себест.",
    type: "number",
    description: "Себестоимость — закупочная цена за 1 шт с карточки товара (поле «Закупочная цена»), задаётся вручную",
    width: 54,
  },
  {
    key: "mpCommissionPct",
    label: "Комисс., %",
    type: "number",
    description: "Комиссия площадки — % от выручки за период (комиссия в рублях / выручка × 100)",
    width: 54,
  },
  {
    key: "mpLogisticsRub",
    label: "Логист. МП",
    type: "number",
    description:
      "Логистика площадки на 1 шт. Для WB — доставка (delivery_rub). Для Ozon — всё, что операция продажи вычла сверх выручки и комиссии (доставка + сопутствующие услуги этой же продажи)",
    width: 56,
  },
  {
    key: "sellPriceRub",
    label: "Цена продажи",
    type: "number",
    description: "Фактическая выручка на 1 шт за период — реальная цена продажи после скидок площадки (не цена в каталоге)",
    width: 58,
  },
  {
    key: "netMarginRub",
    label: "Прибыль с 1 шт, ₽",
    type: "number",
    description:
      "Чистая прибыль с одной проданной штуки = выплата от площадки минус логистика, хранение, реклама, обратная логистика и прочие удержания минус себестоимость",
    width: 62,
  },
  {
    key: "netMarginPct",
    label: "Маржа, %",
    type: "number",
    description: "Прибыль с 1 шт в процентах от цены продажи",
    width: 50,
  },
  {
    key: "roiPct",
    label: "ROI, %",
    type: "number",
    description:
      "Прибыль с 1 шт в процентах от себестоимости — отдача на вложенный в закупку рубль (в отличие от маржи, которая считается от цены продажи). Пусто, если себестоимость не задана",
    width: 48,
  },
  {
    key: "buybackPct",
    label: "% выкупа",
    type: "number",
    description:
      "Только WB: доля реальных заказов, которые НЕ были отменены/не выкуплены за последние 30 дней (заказы младше 10 дней не считаются — исход ещё не известен). Считается по факту заказов, а не по продажам/возвратам",
    width: 52,
  },
  {
    key: "returnsQty",
    label: "Возвраты, шт",
    type: "number",
    description: "Сколько штук вернули за период (из финансового отчёта площадки)",
    width: 52,
  },
  {
    key: "allocatedOverheadRub",
    label: "Расходы без привязки (оценка), ₽",
    type: "number",
    description:
      "Только Ozon, ОЦЕНКА не факт: часть расходов, которые Ozon сам не привязал ни к одному товару (реклама без sku, кросс-докинг и т.п.), разнесённая на 1 шт пропорционально доле этого товара в общей выручке за период",
    width: 68,
  },
  {
    key: "avgDailySalesQty",
    label: "Продаж/день",
    type: "number",
    description: "Среднесуточные продажи по данным аналитики остатков",
    width: 54,
  },
  { key: "stockQty", label: "Остаток", type: "number", description: "Текущий остаток товара на площадке", width: 48 },
  {
    key: "profitPerDayRub",
    label: "Прибыль/день, ₽",
    type: "number",
    description: "Прибыль с 1 шт × Продаж/день — сколько чистыми зарабатываете в среднем за день по этому товару",
    width: 58,
  },
];

// Профит — рендерится отдельно, самым последним столбцом ПОСЛЕ колонок
// "Выплата" по площадкам (не через общий columns.map(), у него фиксированное
// место в конце). Метаданные всё равно нужны — сортировка ищет тип по key
// через этот же объект (см. compareForSort ниже).
const PROFIT_COLUMN = {
  key: "profitRub" as const,
  label: "Профит, ₽",
  type: "number" as const,
  description:
    "Выплата от площадки минус налог (6% с выплаты, УСН «доходы») минус себестоимость — то, что реально остаётся чистыми с продажи 1 шт после уплаты налога",
  width: 58,
};

const detailFields: { key: keyof UnitEconomicsRow; label: string; suffix?: string }[] = [
  { key: "inboundLogisticsRub", label: "Логистика до склада" },
  { key: "mpCommissionRub", label: "Комиссия МП, ₽" },
  { key: "acquiringRub", label: "Эквайринг" },
  { key: "storageRub", label: "Хранение" },
  { key: "otherFeesRub", label: "Другие услуги" },
  { key: "adsRub", label: "Реклама" },
  { key: "taxRub", label: "Налог" },
  { key: "laborAllocRub", label: "ФОТ" },
  { key: "reverseLogisticsRub", label: "Обратная логистика, ₽" },
  { key: "payoutRub", label: "К оплате поставщику" },
];

export default function UnitEconomicsTable({
  rows,
  showActions = true,
  payoutMarketplaces = [],
}: {
  rows: UnitEconomicsRow[];
  // На вкладке "Общая" строки — это агрегат по нескольким магазинам сразу,
  // редактировать/удалять там нечего (нет одной конкретной записи в базе).
  showActions?: boolean;
  // Какие магазины показать колонкой "Выплата" — на "Общей" все сразу, на
  // вкладке одного магазина — только он сам (иначе на вкладке WB были бы
  // видны ещё и Ozon/Яндекс, что путает). Пусто — колонок "Выплата" нет.
  payoutMarketplaces?: { id: string; name: string }[];
}) {
  const payoutColumns = payoutMarketplaces.map((mp) => ({ code: mp.id, label: mp.name }));
  const { pinned, sortKey, sortDir, handleSort, togglePin } = useMultiSort<SortKey>("name");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sorted = useMemo(() => {
    return applyMultiSort(
      rows,
      (a, b, key, dir) => {
        const col = columns.find((c) => c.key === key) ?? (key === "profitRub" ? PROFIT_COLUMN : undefined);
        return compareForSort(a[key], b[key], col?.type, dir);
      },
      pinned,
      sortKey,
      sortDir
    );
  }, [rows, sortKey, sortDir, pinned]);

  const totals = useMemo(() => {
    const sums = rows.reduce(
      (acc, r) => {
        acc.cogsRub += r.cogsRub;
        acc.mpLogisticsRub += r.mpLogisticsRub;
        acc.sellPriceRub += r.sellPriceRub;
        acc.netMarginRub += r.netMarginRub;
        acc.returnsQty += r.returnsQty;
        acc.allocatedOverheadRub += r.allocatedOverheadRub ?? 0;
        acc.avgDailySalesQty += r.avgDailySalesQty;
        acc.stockQty += r.stockQty;
        acc.profitPerDayRub += r.profitPerDayRub;
        acc.profitRub += r.profitRub ?? 0;
        return acc;
      },
      {
        cogsRub: 0,
        mpLogisticsRub: 0,
        sellPriceRub: 0,
        netMarginRub: 0,
        returnsQty: 0,
        allocatedOverheadRub: 0,
        avgDailySalesQty: 0,
        stockQty: 0,
        profitPerDayRub: 0,
        profitRub: 0,
      }
    );
    // Средняя маржинальность/ROI — взвешенные по цене продажи/себестоимости
    // соответственно, а не среднее арифметическое по строкам, иначе мелкий и
    // крупный товар искажали бы итог одинаково.
    const netMarginPct = sums.sellPriceRub > 0 ? (sums.netMarginRub / sums.sellPriceRub) * 100 : 0;
    const roiPct = sums.cogsRub > 0 ? (sums.netMarginRub / sums.cogsRub) * 100 : null;
    const round2 = (n: number) => Math.round(n * 100) / 100;
    return { ...sums, netMarginPct: round2(netMarginPct), roiPct: roiPct !== null ? round2(roiPct) : null };
  }, [rows]);

  return (
    <div className="table-scroll">
      <table className="table-dense">
        <thead>
          <tr>
            <th style={{ width: 20 }}></th>
            <th style={{ width: 72 }}></th>
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
                  description={col.description}
                  style={{ width: col.width, whiteSpace: "normal", verticalAlign: "top" }}
                />
              );
            })}
            {payoutColumns.map((mp) => (
              <th
                key={mp.code}
                style={{ width: 58 }}
                title={`Выплата от ${mp.label} с 1 шт этого товара — за вычетом всех расходов площадки, до себестоимости`}
              >
                {payoutColumns.length > 1 ? `${mp.label}: Выплата, ₽` : "Выплата, ₽"}
              </th>
            ))}
            <SortableTh
              label={PROFIT_COLUMN.label}
              active={pinned?.key === PROFIT_COLUMN.key || sortKey === PROFIT_COLUMN.key}
              dir={pinned?.key === PROFIT_COLUMN.key ? pinned.dir : sortDir}
              pinned={pinned?.key === PROFIT_COLUMN.key}
              onSort={() => handleSort(PROFIT_COLUMN.key)}
              onTogglePin={() => togglePin(PROFIT_COLUMN.key)}
              description={PROFIT_COLUMN.description}
              style={{ width: PROFIT_COLUMN.width, whiteSpace: "normal", verticalAlign: "top" }}
            />
            {showActions && <th style={{ width: 50 }}></th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            if (r.noSales) {
              return (
                <tr key={r.id} className="muted">
                  <td></td>
                  <td>
                    <PhotoThumb url={r.photoUrl} size={64} />
                  </td>
                  <td>
                    {r.sku}
                    <div className="muted">{r.name}</div>
                  </td>
                  <td colSpan={columns.length - 1 + payoutColumns.length + 1}>
                    Нет продаж за последние 30 дней
                  </td>
                  {showActions && <td></td>}
                </tr>
              );
            }
            const marginCls = r.netMarginRub >= 0 ? "margin-positive" : "margin-negative";
            const isExpanded = expanded.has(r.id);
            return (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(r.id)}
                      aria-label="Развернуть детали"
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
                  </td>
                  <td>
                    <PhotoThumb url={r.photoUrl} size={64} />
                  </td>
                  <td>
                    {r.sku}
                    <div className="muted">{r.name}</div>
                  </td>
                  <td>{r.cogsRub}</td>
                  <td>{r.mpCommissionPct !== null ? `${r.mpCommissionPct}%` : "—"}</td>
                  <td>{r.mpLogisticsRub}</td>
                  <td>{r.sellPriceRub}</td>
                  <td className={marginCls}>{r.netMarginRub}</td>
                  <td className={marginCls}>{r.netMarginPct}%</td>
                  <td className={marginCls}>{r.roiPct !== null ? `${r.roiPct}%` : "—"}</td>
                  <td>{r.buybackPct !== null ? `${r.buybackPct}%` : "—"}</td>
                  <td>{r.returnsQty || "—"}</td>
                  <td title={r.allocatedOverheadRub !== null ? "Оценка: доля расходов площадки без привязки к товару, разнесённая пропорционально выручке" : undefined}>
                    {r.allocatedOverheadRub !== null ? r.allocatedOverheadRub : "—"}
                  </td>
                  <td>{r.avgDailySalesQty || "—"}</td>
                  <td>{r.stockQty || "—"}</td>
                  <td className={marginCls}>{r.profitPerDayRub || "—"}</td>
                  {payoutColumns.map((mp) => {
                    const value = r.payoutByMarketplace?.[mp.code] ?? null;
                    return (
                      <td key={mp.code} className={value !== null ? (value >= 0 ? "margin-positive" : "margin-negative") : undefined}>
                        {value !== null ? value : "—"}
                      </td>
                    );
                  })}
                  <td className={r.profitRub !== null ? (r.profitRub >= 0 ? "margin-positive" : "margin-negative") : undefined}>
                    {r.profitRub !== null ? r.profitRub : "—"}
                  </td>
                  {showActions && (
                    <td className="row-actions">
                      <EditIconLink href={`/unit-economics/${r.id}`} />
                      <DeleteIconButton
                        endpoint={`/api/unit-economics/${r.id}`}
                        confirmMessage="Удалить этот расчёт юнит-экономики?"
                      />
                    </td>
                  )}
                </tr>
                {isExpanded && (
                  <tr>
                    <td
                      colSpan={columns.length + 1 + (showActions ? 2 : 1) + payoutColumns.length + 1}
                      style={{ background: "var(--surface-alt)", padding: 12 }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                          gap: 8,
                          fontSize: 13,
                        }}
                      >
                        {detailFields.map((f) => {
                          const value = r[f.key];
                          return (
                            <div key={f.key}>
                              <div className="muted">{f.label}</div>
                              <div>
                                {value !== null && value !== undefined ? `${value}${f.suffix ?? ""}` : "—"}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {r.details && Object.keys(r.details).length > 0 && (
                        <>
                          <div className="muted" style={{ marginTop: 12, marginBottom: 4, fontWeight: 600 }}>
                            Все параметры расчёта (из исходного файла/API)
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                              gap: 8,
                              fontSize: 13,
                            }}
                          >
                            {Object.entries(r.details).map(([key, value]) => {
                              if (value === null || value === undefined) return null;
                              const meta = DETAILS_LABELS[key];
                              return (
                                <div key={key}>
                                  <div className="muted">{meta?.label ?? key}</div>
                                  <div>
                                    {formatDetailValue(value)}
                                    {meta?.suffix ?? ""}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 600 }}>
            <td></td>
            <td></td>
            <td>Итого ({rows.length})</td>
            <td>{Math.round(totals.cogsRub * 100) / 100}</td>
            <td></td>
            <td>{Math.round(totals.mpLogisticsRub * 100) / 100}</td>
            <td>{Math.round(totals.sellPriceRub * 100) / 100}</td>
            <td className={totals.netMarginRub >= 0 ? "margin-positive" : "margin-negative"}>
              {Math.round(totals.netMarginRub * 100) / 100}
            </td>
            <td className={totals.netMarginRub >= 0 ? "margin-positive" : "margin-negative"}>
              {totals.netMarginPct}%
            </td>
            <td className={totals.netMarginRub >= 0 ? "margin-positive" : "margin-negative"}>
              {totals.roiPct !== null ? `${totals.roiPct}%` : "—"}
            </td>
            <td></td>
            <td>{totals.returnsQty}</td>
            <td>{Math.round(totals.allocatedOverheadRub * 100) / 100}</td>
            <td>{Math.round(totals.avgDailySalesQty * 100) / 100}</td>
            <td>{totals.stockQty}</td>
            <td className={totals.profitPerDayRub >= 0 ? "margin-positive" : "margin-negative"}>
              {Math.round(totals.profitPerDayRub * 100) / 100}
            </td>
            {payoutColumns.map((mp) => <td key={mp.code}></td>)}
            <td className={totals.profitRub >= 0 ? "margin-positive" : "margin-negative"}>
              {Math.round(totals.profitRub * 100) / 100}
            </td>
            {showActions && <td></td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
