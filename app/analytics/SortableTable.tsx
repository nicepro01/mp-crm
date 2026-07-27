"use client";

import { CSSProperties, Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SortableTh } from "@/app/components/SortableTh";
import { useMultiSort, applyMultiSort } from "@/lib/useMultiSort";
import PhotoThumb from "@/app/products/PhotoThumb";

// Высота nav (см. globals.css) — заголовки таблиц прилипают чуть ниже неё,
// а не поверх. Значение фиксированное (nav не меняет высоту), держать в
// синхроне с `nav { height: ... }` в globals.css.
const NAV_HEIGHT = 56;

type ColumnType = "string" | "number" | "date" | "status" | "photo";

export type SortableColumn = {
  key: string;
  label: string;
  type?: ColumnType;
  /** Подсказка при наведении — что это за колонка и как считается. */
  description?: string;
  /** Фиксированная ширина колонки в px — используется вместе с `dense` на
   * SortableTable, чтобы широкие таблицы (много колонок) укладывались в
   * экран по ширине без горизонтального скролла, а не подбирались браузером
   * по содержимому. Без `dense` игнорируется (обычный table-layout: auto). */
  width?: number;
  /** Не переносить текст на 2-ю строку (для коротких значений вроде SKU) —
   * в 1 строку, лишнее обрезается многоточием (полное значение — в title
   * при наведении). Без этого overflow-wrap:anywhere из dense-режима может
   * перенести число посередине, что выглядит некрасиво. */
  noWrap?: boolean;
  /** Фоновая заливка всей колонки (CSS color/rgba) — группирует "родственные"
   * колонки одним цветом, чтобы легче было визуально отследить, напр., все
   * колонки "Цена" среди множества площадок/метрик рядом. */
  bg?: string;
};

export type ClusterRow = {
  id: string;
  clusterName: string;
  qtyAvailable: number;
  avgDailySalesQty: number;
  daysOfStockLeft: number | null;
  liquidityStatus: string | null;
  /** Сколько из общей рекомендации заказа отгрузить именно сюда — только
   * там, где актуально (напр. разбивка по площадкам во вкладке "Пора
   * заказывать"); если не задано, колонка не показывается вовсе. */
  allocatedQty?: number;
};

const statusColors: Record<string, string> = {
  "Дефицитный": "#b91c1c",
  "Избыточный": "#a16207",
  "Без продаж": "#6b7280",
};

function StatusText({ status }: { status: string | null }) {
  if (!status) return <span className="muted">—</span>;
  return <span style={{ color: statusColors[status] ?? "var(--fg)", fontWeight: 600 }}>{status}</span>;
}

// Заголовки прилипающие (sticky) и должны оставаться непрозрачными, иначе
// контент под ними будет просвечивать при скролле — поэтому цветовую заливку
// колонки накладываем ПОВЕРХ непрозрачного базового фона слоями (не заменяем
// его), а не просто ставим col.bg как есть.
function columnBackground(bg: string | undefined, opaqueBase?: string): string | undefined {
  if (!bg) return opaqueBase;
  return opaqueBase ? `linear-gradient(${bg}, ${bg}), ${opaqueBase}` : bg;
}

// Заголовок строго в 2 строки на заранее известной границе — по первому
// пробелу ("WB Профит" → "WB" / "Профит"), а не там, где браузеру случится
// перенести. Каждая половина — рассчитана быть ОДНИМ словом (без запятых/₽/
// лишних пробелов в самом заголовке — единицы измерения и т.п. только в
// подсказке при наведении), иначе она сама может перенестись ещё раз
// (overflow-wrap: anywhere из dense-режима) и вместо 2 строк выйдет 3-4.
function twoLineHeaderLabel(label: string): React.ReactNode {
  const spaceIdx = label.indexOf(" ");
  if (spaceIdx === -1) return label;
  return (
    <>
      {label.slice(0, spaceIdx)}
      <br />
      {label.slice(spaceIdx + 1)}
    </>
  );
}

function compareValues(
  a: unknown,
  b: unknown,
  type: ColumnType | undefined,
  dir: "asc" | "desc" = "asc"
): number {
  const aEmpty = a === null || a === undefined || a === "";
  const bEmpty = b === null || b === undefined || b === "";
  // Пустые значения всегда в конце, независимо от направления — направление
  // применяется только к сравнению двух настоящих значений ниже, а не
  // переворотом всего массива (иначе пустые оказались бы в начале при
  // сортировке по убыванию).
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let result: number;
  if (type === "number") result = Number(a) - Number(b);
  else if (type === "date") result = new Date(a as string).getTime() - new Date(b as string).getTime();
  else result = String(a).localeCompare(String(b), "ru");
  return dir === "asc" ? result : -result;
}

function buildClusterColumns(groupLabel: string, showAllocated: boolean): SortableColumn[] {
  const columns: SortableColumn[] = [
    { key: "clusterName", label: groupLabel, type: "string", description: "Город/склад (или площадка — во вкладке «Все товары» без разбивки по регионам)" },
    { key: "qtyAvailable", label: "Остаток", type: "number", description: "Текущий остаток на этом складе" },
    { key: "avgDailySalesQty", label: "Продаж/день", type: "number", description: "Средняя скорость продаж именно с этого склада" },
    { key: "daysOfStockLeft", label: "Дней до конца", type: "number", description: "Остаток ÷ продаж/день — на сколько дней хватит именно на этом складе" },
    { key: "liquidityStatus", label: "Статус", type: "status", description: "Дефицит/избыток по этому складу (только там, где есть такая категоризация)" },
  ];
  if (showAllocated) {
    columns.push({ key: "allocatedQty", label: "Отгрузить, шт", type: "number", description: "Сколько из рекомендованного заказа предлагается отгрузить именно сюда, пропорционально нехватке" });
  }
  return columns;
}

function ClusterSubTable({
  clusters,
  stickyTop,
  groupLabel,
}: {
  clusters: ClusterRow[];
  stickyTop: number;
  groupLabel: string;
}) {
  const { pinned, sortKey, sortDir, handleSort, togglePin } = useMultiSort<string>("daysOfStockLeft");
  const showAllocated = clusters.some((c) => c.allocatedQty !== undefined);
  const clusterColumns = useMemo(
    () => buildClusterColumns(groupLabel, showAllocated),
    [groupLabel, showAllocated]
  );

  const sorted = useMemo(() => {
    return applyMultiSort(
      clusters,
      (a, b, key, dir) => {
        const col = clusterColumns.find((c) => c.key === key);
        return compareValues((a as any)[key], (b as any)[key], col?.type, dir);
      },
      pinned,
      sortKey,
      sortDir
    );
  }, [clusters, sortKey, sortDir, pinned, clusterColumns]);

  return (
    <table>
      <thead>
        <tr>
          {clusterColumns.map((col) => {
            const isPinned = pinned?.key === col.key;
            return (
              <SortableTh
                key={col.key}
                label={col.label}
                active={isPinned || sortKey === col.key}
                dir={isPinned ? pinned!.dir : sortDir}
                pinned={isPinned}
                onSort={() => handleSort(col.key)}
                onTogglePin={() => togglePin(col.key)}
                description={col.description}
                style={{
                  whiteSpace: "normal",
                  verticalAlign: "top",
                  position: "sticky",
                  top: stickyTop,
                  zIndex: 1,
                  background: "var(--surface-alt)",
                }}
              />
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((c) => (
          <tr key={c.id}>
            <td>{c.clusterName}</td>
            <td>{c.qtyAvailable}</td>
            <td>{c.avgDailySalesQty}</td>
            <td>{c.daysOfStockLeft ?? "—"}</td>
            <td>
              <StatusText status={c.liquidityStatus} />
            </td>
            {showAllocated && (
              <td style={{ fontWeight: 600 }}>
                {c.allocatedQty && c.allocatedQty > 0 ? c.allocatedQty : "—"}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SortableTable({
  columns,
  rows,
  rowKey,
  defaultSortKey = null,
  defaultSortDir = "asc",
  expandKey,
  clustersByKey,
  expandGroupLabel = "Регион",
  expandSectionTitle = "По регионам",
  dense = false,
  maxWidth,
  photoSize: photoSizeOverride,
  denseFontLarge = false,
}: {
  columns: SortableColumn[];
  rows: Record<string, any>[];
  rowKey: string;
  defaultSortKey?: string | null;
  defaultSortDir?: "asc" | "desc";
  /** Поле в строке (обычно productId), по которому ищем данные в clustersByKey */
  expandKey?: string;
  /** Данные для разворота строки — по регионам (Ozon) или по площадкам (сводный вид) */
  clustersByKey?: Record<string, ClusterRow[]>;
  /** Подпись первой колонки в развёрнутой таблице: "Регион" или "Площадка" */
  expandGroupLabel?: string;
  /** Заголовок над развёрнутой таблицей: "По регионам" или "По площадкам" */
  expandSectionTitle?: string;
  /** Плотный режим для таблиц с большим числом колонок (см. `width` на
   * SortableColumn) — мельче отступы/шрифт и fixed-раскладка колонок,
   * чтобы вся таблица укладывалась по ширине экрана без горизонтального
   * скролла страницы. */
  dense?: boolean;
  /** Только вместе с `dense` — таблица не растягивается на 100% широкого
   * контейнера (что на большом экране раздувает узкие колонки огромными
   * пустыми полями), а сама по себе не шире суммы ширин колонок; на узком
   * экране всё равно сжимается до 100% контейнера (см. table-dense-capped
   * в globals.css), горизонтальный скролл не появляется в любом случае. */
  maxWidth?: number;
  /** Переопределяет размер миниатюры фото (по умолчанию 40 в dense, 88 без
   * него) — напр. когда в dense-таблице фото всё равно должно быть крупным. */
  photoSize?: number;
  /** Только вместе с `dense` — чуть крупнее шрифт (14px/13.5px вместо
   * 12.5px/12px), для таблиц, где после сужения колонок текст стал мелковат. */
  denseFontLarge?: boolean;
}) {
  const { pinned, sortKey, sortDir, handleSort, togglePin } = useMultiSort<string>(
    defaultSortKey ?? columns[0]?.key ?? "",
    defaultSortDir
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const firstBodyRowRef = useRef<HTMLTableRowElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const sortedRows = useMemo(() => {
    return applyMultiSort(
      rows,
      (a, b, key, dir) => {
        const col = columns.find((c) => c.key === key);
        return compareValues(a[key], b[key], col?.type, dir);
      },
      pinned,
      sortKey,
      sortDir
    );
  }, [rows, columns, sortKey, sortDir, pinned]);

  const canExpand = Boolean(expandKey && clustersByKey);
  const colSpan = columns.length + (canExpand ? 1 : 0);

  // Меряем реальную высоту шапки и строки таблицы (а не гадаем в px),
  // чтобы прилипающая строка товара и шапка мини-таблицы по регионам
  // вставали строго встык, без "зазора" между ними.
  useLayoutEffect(() => {
    if (!canExpand) return;
    const headerEl = headerRowRef.current;
    const rowEl = firstBodyRowRef.current;
    if (!headerEl || !rowEl) return;

    const update = () => {
      setHeaderHeight(headerEl.getBoundingClientRect().height);
      setRowHeight(rowEl.getBoundingClientRect().height);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(headerEl);
    observer.observe(rowEl);
    return () => observer.disconnect();
  }, [canExpand, columns, sortedRows.length]);

  const expandedRowStickyTop = NAV_HEIGHT + headerHeight;
  const clusterHeaderStickyTop = NAV_HEIGHT + headerHeight + rowHeight;

  const photoSize = photoSizeOverride ?? (dense ? 40 : 88);

  return (
    <table
      className={dense ? (denseFontLarge ? "table-dense-lg" : "table-dense") : undefined}
      style={maxWidth ? { maxWidth } : undefined}
    >
      <thead>
        <tr ref={headerRowRef}>
          {canExpand && (
            <th
              style={{
                width: 28,
                position: "sticky",
                top: NAV_HEIGHT,
                zIndex: 1,
                background: "var(--surface-alt)",
              }}
            />
          )}
          {columns.map((col) => {
            // Миниатюра не сортируется — просто прилипающий заголовок-заглушка.
            if (col.type === "photo") {
              return (
                <th
                  key={col.key}
                  style={{
                    width: col.width ?? (dense ? 52 : 108),
                    position: "sticky",
                    top: NAV_HEIGHT,
                    zIndex: 1,
                    background: columnBackground(col.bg, "var(--surface-alt)"),
                  }}
                />
              );
            }
            const isPinned = pinned?.key === col.key;
            return (
              <SortableTh
                key={col.key}
                label={col.noWrap ? twoLineHeaderLabel(col.label) : col.label}
                active={isPinned || sortKey === col.key}
                dir={isPinned ? pinned!.dir : sortDir}
                pinned={isPinned}
                onSort={() => handleSort(col.key)}
                onTogglePin={() => togglePin(col.key)}
                description={col.description}
                style={{
                  whiteSpace: "normal",
                  // dense-режим ставит overflow-wrap:anywhere глобально (см.
                  // globals.css) — это ломает мид-словное "Разброс" на
                  // "Разбро"/"с", если слово не помещается в узкую колонку.
                  // Для заголовков, разбитых на 2 строки по одному слову
                  // (twoLineHeaderLabel), это отключаем — лучше слово чуть
                  // вылезет за рамку колонки, чем разъедется по буквам.
                  overflowWrap: col.noWrap ? "normal" : undefined,
                  wordBreak: col.noWrap ? "keep-all" : undefined,
                  // Если слово всё же не помещается в отведённую колонку —
                  // обрезаем по границе ячейки, а не даём вылезти на соседние
                  // колонки (это и не давало таблице уложиться в экран).
                  overflow: col.noWrap ? "hidden" : undefined,
                  verticalAlign: "top",
                  position: "sticky",
                  top: NAV_HEIGHT,
                  zIndex: 1,
                  background: columnBackground(col.bg, "var(--surface-alt)"),
                  width: col.width,
                }}
              />
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row, index) => {
          const key = String(row[rowKey]);
          const clusters = canExpand ? clustersByKey![row[expandKey!]] : undefined;
          const isExpanded = expanded.has(key);

          const stickyRowStyle: CSSProperties | undefined = isExpanded
            ? {
                position: "sticky",
                top: expandedRowStickyTop,
                zIndex: 2,
                background: "var(--surface)",
              }
            : undefined;

          return (
            <Fragment key={key}>
              <tr ref={index === 0 ? firstBodyRowRef : undefined}>
                {canExpand && (
                  <td style={stickyRowStyle}>
                    {clusters && clusters.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(key)}
                        aria-label={expandSectionTitle}
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
                    ) : null}
                  </td>
                )}
                {columns.map((col) => {
                  const value = row[col.key];
                  // Заливка колонки: у обычных строк — просто col.bg поверх
                  // фона таблицы; у "прилипшей" развёрнутой строки нужно
                  // сохранить её непрозрачный фон (var(--surface)), иначе
                  // контент под ней будет просвечивать при скролле.
                  const cellBg = isExpanded
                    ? columnBackground(col.bg, "var(--surface)")
                    : col.bg;
                  const cellStyle: CSSProperties = { ...stickyRowStyle, ...(cellBg ? { background: cellBg } : {}) };
                  if (col.type === "photo") {
                    return (
                      <td key={col.key} style={cellStyle}>
                        <PhotoThumb url={value ?? null} size={photoSize} />
                      </td>
                    );
                  }
                  if (col.type === "status") {
                    return (
                      <td key={col.key} style={cellStyle}>
                        <StatusText status={value} />
                      </td>
                    );
                  }
                  if (col.type === "date") {
                    return (
                      <td key={col.key} style={cellStyle}>
                        {value ? new Date(value).toLocaleDateString("ru-RU") : "—"}
                      </td>
                    );
                  }
                  if (col.noWrap) {
                    return (
                      <td
                        key={col.key}
                        style={{
                          ...cellStyle,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={value === null || value === undefined ? undefined : String(value)}
                      >
                        {value === null || value === undefined ? "—" : value}
                      </td>
                    );
                  }
                  return (
                    <td key={col.key} style={cellStyle}>
                      {value === null || value === undefined ? "—" : value}
                    </td>
                  );
                })}
              </tr>
              {canExpand && isExpanded && clusters && (
                <tr>
                  <td colSpan={colSpan} style={{ background: "var(--surface-alt)", padding: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                      {expandSectionTitle} ({clusters.length})
                    </div>
                    <ClusterSubTable
                      clusters={clusters}
                      stickyTop={clusterHeaderStickyTop}
                      groupLabel={expandGroupLabel}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
