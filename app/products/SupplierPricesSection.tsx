"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Supplier = { id: string; name: string };

type SupplierPriceRow = {
  id: string;
  supplierId: string;
  supplierName: string;
  priceCny: string;
  validFrom: string;
  validTo: string | null;
  minQty: number | null;
};

export default function SupplierPricesSection({
  productId,
  suppliers,
  prices,
  mainSupplierId,
}: {
  productId: string;
  suppliers: Supplier[];
  prices: SupplierPriceRow[];
  mainSupplierId?: string | null;
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [priceCny, setPriceCny] = useState("");
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [validTo, setValidTo] = useState("");
  const [minQty, setMinQty] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const res = await fetch("/api/supplier-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        supplierId,
        priceCny,
        validFrom,
        validTo: validTo || null,
        minQty: minQty || null,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка сохранения");
      return;
    }

    setSupplierId("");
    setPriceCny("");
    setValidTo("");
    setMinQty("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить эту цену?")) return;
    const res = await fetch(`/api/supplier-prices/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.refresh();
    } else {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Не удалось удалить");
    }
  }

  return (
    <div>
      {prices.length === 0 ? (
        <p className="muted">Цен от поставщиков ещё не заводили.</p>
      ) : (
        <div className="table-scroll" style={{ marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Поставщик</th>
                <th>Цена, CNY</th>
                <th>Действует с</th>
                <th>Действует по</th>
                <th>Мин. партия</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p, idx) => (
                <tr key={p.id}>
                  <td>
                    <a href={`/suppliers/${p.supplierId}`}>{p.supplierName}</a>
                    {p.supplierId === mainSupplierId && (
                      <span className="muted"> · текущий поставщик</span>
                    )}
                    {idx === 0 && prices.length > 1 && (
                      <span className="muted"> · дешевле всех</span>
                    )}
                  </td>
                  <td>{p.priceCny}</td>
                  <td>{p.validFrom}</td>
                  <td>{p.validTo ?? "—"}</td>
                  <td>{p.minQty ?? "—"}</td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleDelete(p.id)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleAdd} style={{ maxWidth: 480 }}>
        <div className="muted">Добавить цену от поставщика</div>
        {error && <div className="error">{error}</div>}

        <label>
          Поставщик *
          <select
            required
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
          >
            <option value="" disabled>
              Выберите поставщика
            </option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <div className="row">
          <label>
            Цена, CNY *
            <input
              required
              type="number"
              step="0.0001"
              value={priceCny}
              onChange={(e) => setPriceCny(e.target.value)}
            />
          </label>
          <label>
            Мин. партия
            <input
              type="number"
              value={minQty}
              onChange={(e) => setMinQty(e.target.value)}
            />
          </label>
        </div>

        <div className="row">
          <label>
            Действует с *
            <input
              required
              type="date"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </label>
          <label>
            Действует по
            <input
              type="date"
              value={validTo}
              onChange={(e) => setValidTo(e.target.value)}
            />
          </label>
        </div>

        <div className="actions">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Сохранение…" : "Добавить"}
          </button>
        </div>
      </form>
    </div>
  );
}
