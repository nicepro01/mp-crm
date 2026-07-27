"use client";

import { useState } from "react";
import SortableTable, { SortableColumn } from "./SortableTable";

export type AttentionScope = {
  code: string;
  label: string;
  rows: Record<string, unknown>[];
};

// Переключатель площадки для виджета "Товары, требующие внимания" на
// дашборде — та же площадка, что и в разделах ниже; "Все площадки" — вид по
// умолчанию, объединяющий все три сразу.
export default function AttentionWidget({
  scopes,
  columns,
}: {
  scopes: AttentionScope[];
  columns: SortableColumn[];
}) {
  const [activeCode, setActiveCode] = useState(scopes[0]?.code ?? "");
  const active = scopes.find((s) => s.code === activeCode) ?? scopes[0];
  if (!active) return null;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {scopes.map((s) => (
          <button
            key={s.code}
            type="button"
            className={s.code === activeCode ? "btn" : "btn btn-secondary"}
            onClick={() => setActiveCode(s.code)}
          >
            {s.label} ({s.rows.length})
          </button>
        ))}
      </div>
      {active.rows.length === 0 ? (
        <p className="muted">Ничего срочного не найдено.</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
            columns={columns}
            rows={active.rows}
            rowKey="id"
            defaultSortKey="netMarginPct"
            defaultSortDir="asc"
          />
        </div>
      )}
    </div>
  );
}
