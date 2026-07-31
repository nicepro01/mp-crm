"use client";

import { useState } from "react";

export default function InTransitExportButton() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setExporting(true);
    const res = await fetch("/api/batches/export-in-transit");
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
    a.download = `v-puti-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleExport}
        disabled={exporting}
        title="Список товаров по всем поставкам в статусе «В пути» — для сотрудников"
      >
        {exporting ? "Выгружаю…" : "Экспорт: что в пути"}
      </button>
      {error && <div className="error">{error}</div>}
    </>
  );
}
