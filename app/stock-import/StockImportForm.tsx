"use client";

import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { useState } from "react";

type Marketplace = { id: string; name: string };

type ImportSummary = {
  total: number;
  updated: number;
  pending: number;
  skipped: number;
  invalid: number;
  pendingCodes: string[];
};

const warehouseTypeLabels: Record<string, string> = {
  MARKETPLACE_FBO: "FBO (склад площадки)",
  MARKETPLACE_FBS: "FBS (свой склад под площадку)",
};

export default function StockImportForm({
  marketplaces,
}: {
  marketplaces: Marketplace[];
}) {
  const router = useRouter();
  const [marketplaceId, setMarketplaceId] = useState("");
  const [warehouseType, setWarehouseType] = useState("MARKETPLACE_FBO");

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [fileName, setFileName] = useState("");

  const [skuCol, setSkuCol] = useState("");
  const [barcodeCol, setBarcodeCol] = useState("");
  const [qtyCol, setQtyCol] = useState("");

  const [parseError, setParseError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setResult(null);
    setError(null);
    setParseError(null);
    setFileName(file.name);

    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data;
        if (data.length < 2) {
          setParseError("В файле нет строк с данными (только заголовок или файл пуст)");
          setHeaders([]);
          setRows([]);
          return;
        }
        const [header, ...dataRows] = data;
        setHeaders(header.map((h) => String(h ?? "").trim()));
        setRows(dataRows);
        setSkuCol("");
        setBarcodeCol("");
        setQtyCol("");
      },
      error: (err) => {
        setParseError(err.message ?? "Не удалось прочитать файл");
      },
    });
  }

  async function handleImport() {
    if (!marketplaceId || !skuCol || !qtyCol) {
      setError("Выберите площадку, склад и обязательные колонки (артикул, остаток)");
      return;
    }

    const skuIdx = headers.indexOf(skuCol);
    const barcodeIdx = barcodeCol ? headers.indexOf(barcodeCol) : -1;
    const qtyIdx = headers.indexOf(qtyCol);

    const mappedRows = rows.map((r) => ({
      mpSku: r[skuIdx] ?? "",
      barcode: barcodeIdx >= 0 ? r[barcodeIdx] ?? null : null,
      qty: Number(String(r[qtyIdx] ?? "").replace(",", ".")),
    }));

    setImporting(true);
    setError(null);

    const res = await fetch("/api/stock-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketplaceId, warehouseType, rows: mappedRows }),
    });

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
      <div className="row">
        <label>
          Площадка *
          <select
            required
            value={marketplaceId}
            onChange={(e) => setMarketplaceId(e.target.value)}
          >
            <option value="" disabled>
              Выберите площадку
            </option>
            {marketplaces.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Склад *
          <select value={warehouseType} onChange={(e) => setWarehouseType(e.target.value)}>
            {Object.entries(warehouseTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Файл CSV
        <input type="file" accept=".csv,text/csv" onChange={handleFile} />
      </label>
      {parseError && <div className="error">{parseError}</div>}

      {headers.length > 0 && (
        <>
          <div className="muted">
            Файл «{fileName}»: {rows.length} строк с данными. Укажите, какие
            колонки за что отвечают:
          </div>

          <div className="row">
            <label>
              Колонка с артикулом площадки (SKU/nmID) *
              <select required value={skuCol} onChange={(e) => setSkuCol(e.target.value)}>
                <option value="" disabled>
                  Выберите колонку
                </option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Колонка со штрихкодом
              <select value={barcodeCol} onChange={(e) => setBarcodeCol(e.target.value)}>
                <option value="">Нет / не использовать</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Колонка с остатком (количество) *
            <select required value={qtyCol} onChange={(e) => setQtyCol(e.target.value)}>
              <option value="" disabled>
                Выберите колонку
              </option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    {headers.map((_, j) => (
                      <td key={j}>{r[j]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted">Показаны первые 5 строк из {rows.length}.</div>

          {error && <div className="error">{error}</div>}

          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? "Импортирую…" : "Импортировать"}
            </button>
          </div>
        </>
      )}

      {result && (
        <div
          className="muted"
          style={{ background: "var(--surface-alt)", padding: "10px 12px", borderRadius: 6, marginTop: 16 }}
        >
          Обработано: {result.total} · обновлено остатков: {result.updated} · ждут
          сопоставления: <strong>{result.pending}</strong>
          {result.skipped > 0 && <> · пропущено: {result.skipped}</>}
          {result.invalid > 0 && <> · с некорректным количеством: {result.invalid}</>}
          {result.pending > 0 && (
            <div style={{ marginTop: 8 }}>
              Несопоставленные коды: {result.pendingCodes.join(", ")}
              <br />
              Перейдите на <a href="/matching">страницу «Сопоставление»</a>,
              привяжите их к товарам и запустите импорт этого же файла ещё раз —
              остатки подтянутся.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
