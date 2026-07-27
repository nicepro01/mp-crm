"use client";

import { useState } from "react";

export default function WarehouseExportButton({ batchId }: { batchId: string }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setExporting(true);
    const res = await fetch(`/api/batches/${batchId}/warehouse-export`);
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
    a.download = `sklad-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-secondary" onClick={handleExport} disabled={exporting}>
        {exporting ? "Выгружаю…" : "Скачать раскладку по складам"}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
