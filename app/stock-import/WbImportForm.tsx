"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ImportSummary = {
  total: number;
  updated: number;
  pending: number;
  skipped: number;
  pendingCodes: string[];
};

export default function WbImportForm() {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSummary | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setResult(null);
    setImporting(true);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/stock-import/wb", { method: "POST", body: formData });
    setImporting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка импорта");
      return;
    }

    const body: ImportSummary = await res.json();
    setResult(body);
    router.refresh();
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <label>
        Файл отчёта «Остатки» WB (.xlsx), как есть
        <input type="file" accept=".xlsx" onChange={handleFile} disabled={importing} />
      </label>
      {importing && <div className="muted">Загрузка и разбор файла «{fileName}»…</div>}
      {error && <div className="error">{error}</div>}

      {result && (
        <div
          className="muted"
          style={{ background: "var(--surface-alt)", padding: "10px 12px", borderRadius: 6, marginTop: 12 }}
        >
          Обработано артикулов: {result.total} · обновлено остатков: {result.updated}
          {result.skipped > 0 && <> · пропущено: {result.skipped}</>}
          {" · "}ждут сопоставления: <strong>{result.pending}</strong>
          {result.pending > 0 && (
            <div style={{ marginTop: 8 }}>
              Несопоставленные артикулы: {result.pendingCodes.join(", ")}
              <br />
              Перейдите на <a href="/matching">страницу «Сопоставление»</a> и привяжите
              их к товарам — у WB нет числового кода, сопоставлять нужно
              вручную по названию.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
