"use client";

import { useState } from "react";

export default function ExportProductsButton({
  marketplaceId,
  marketplaceName,
}: {
  marketplaceId: string;
  marketplaceName: string;
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setError(null);
    setExporting(true);
    const res = await fetch(`/api/marketplaces/${marketplaceId}/export-products`);
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
    a.download = `tovary-${marketplaceName}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleExport}
        disabled={exporting}
        title="Список всех товаров этого магазина с остатком и продажами — для ревизии ассортимента"
      >
        {exporting ? "Выгружаю…" : `Экспорт товаров «${marketplaceName}»`}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
