"use client";

import { useState } from "react";
import SortableTable, { SortableColumn } from "./SortableTable";

// Переключатель "только приоритетные" над таблицей "Сравнение площадок" —
// строки с priorityCandidate: true (см. расчёт в page.tsx: A/B-товар там, где
// он и так лучше всего продаётся, но на худшей по профиту площадке реклама
// не окупается) можно отфильтровать, не листая всю таблицу глазами в поисках
// подходящих строк.
export default function PriorityFilterTable({
  columns,
  rows,
  rowKey,
  defaultSortKey,
  defaultSortDir,
  dense,
  photoSize,
  denseFontLarge,
}: {
  columns: SortableColumn[];
  rows: Record<string, unknown>[];
  rowKey: string;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  dense?: boolean;
  photoSize?: number;
  denseFontLarge?: boolean;
}) {
  const [onlyPriority, setOnlyPriority] = useState(false);
  const priorityCount = rows.filter((r) => r.priorityCandidate === true).length;
  const visibleRows = onlyPriority ? rows.filter((r) => r.priorityCandidate === true) : rows;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className={!onlyPriority ? "btn" : "btn btn-secondary"}
          onClick={() => setOnlyPriority(false)}
        >
          Все товары ({rows.length})
        </button>
        <button
          type="button"
          className={onlyPriority ? "btn" : "btn btn-secondary"}
          onClick={() => setOnlyPriority(true)}
          disabled={priorityCount === 0}
        >
          🔥 Только приоритетные ({priorityCount})
        </button>
      </div>
      {visibleRows.length === 0 ? (
        <p className="muted">Нет приоритетных кандидатов — не значит, что всё хорошо, просто по этому критерию ничего не выделяется.</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
            columns={columns}
            rows={visibleRows}
            rowKey={rowKey}
            defaultSortKey={defaultSortKey}
            defaultSortDir={defaultSortDir}
            dense={dense}
            photoSize={photoSize}
            denseFontLarge={denseFontLarge}
          />
        </div>
      )}
    </div>
  );
}
