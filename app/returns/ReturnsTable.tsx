"use client";

import { useMemo } from "react";
import { compareForSort } from "@/lib/sortCompare";
import { SortableTh } from "@/app/components/SortableTh";
import { useMultiSort, applyMultiSort } from "@/lib/useMultiSort";

export type ReturnClaimRow = {
  id: string;
  sku: string | null;
  name: string;
  status: number;
  reasonText: string | null;
  priceRub: number | null;
  claimDate: string;
  orderDate: string | null;
  photos: string[];
};

// Точного словаря статусов WB не публикует — значения выведены по
// наблюдению за реальными данными (активные заявки всегда 0, архивные —
// 1 или 2).
const STATUS_LABELS: Record<number, string> = {
  0: "Новая (ждёт решения)",
  1: "Одобрена",
  2: "Отклонена",
};

type SortKey = "sku" | "status" | "priceRub" | "claimDate" | "orderDate";

const columns: { key: SortKey; label: string; type: "string" | "number" }[] = [
  { key: "sku", label: "Товар", type: "string" },
  { key: "status", label: "Статус", type: "number" },
  { key: "priceRub", label: "Цена, ₽", type: "number" },
  // ISO 8601 сортируется как обычная строка правильно по дате.
  { key: "orderDate", label: "Дата заказа", type: "string" },
  { key: "claimDate", label: "Дата заявки", type: "string" },
];

export default function ReturnsTable({ rows }: { rows: ReturnClaimRow[] }) {
  const { pinned, sortKey, sortDir, handleSort, togglePin } = useMultiSort<SortKey>("claimDate", "desc");

  const sorted = useMemo(() => {
    return applyMultiSort(
      rows,
      (a, b, key, dir) => {
        const col = columns.find((c) => c.key === key);
        return compareForSort(a[key], b[key], col?.type, dir);
      },
      pinned,
      sortKey,
      sortDir
    );
  }, [rows, sortKey, sortDir, pinned]);

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
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
            <th>Причина</th>
            <th>Фото</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>
                {r.sku ?? "—"}
                <div className="muted">{r.name}</div>
              </td>
              <td>{STATUS_LABELS[r.status] ?? `Статус ${r.status}`}</td>
              <td>{r.priceRub ?? "—"}</td>
              <td>{r.orderDate ? r.orderDate.slice(0, 10) : "—"}</td>
              <td>{r.claimDate.slice(0, 10)}</td>
              <td style={{ maxWidth: 320 }} title={r.reasonText ?? ""}>
                {r.reasonText ? (r.reasonText.length > 100 ? r.reasonText.slice(0, 100) + "…" : r.reasonText) : "—"}
              </td>
              <td>
                {r.photos.length > 0 ? (
                  <a
                    href={r.photos[0].startsWith("//") ? `https:${r.photos[0]}` : r.photos[0]}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Фото ({r.photos.length})
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
  );
}
