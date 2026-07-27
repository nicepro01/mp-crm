"use client";

export function SortableTh({
  label,
  active,
  dir,
  pinned,
  onSort,
  onTogglePin,
  style,
  subtitle,
  description,
}: {
  label: React.ReactNode;
  active: boolean;
  dir: "asc" | "desc";
  pinned: boolean;
  onSort: () => void;
  onTogglePin: () => void;
  style?: React.CSSProperties;
  /** Доп. строка под названием колонки (напр. тип склада) — не участвует в сортировке. */
  subtitle?: React.ReactNode;
  /** Подсказка при наведении — что это за колонка и как считается. */
  description?: string;
}) {
  return (
    <th style={{ ...style, userSelect: "none" }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <span onClick={onSort} style={{ cursor: "pointer" }} title={description ?? "Сортировать"}>
          {label}
          {active ? (dir === "asc" ? " ▲" : " ▼") : ""}
        </span>
      </div>
      {subtitle && <div>{subtitle}</div>}
    </th>
  );
}
