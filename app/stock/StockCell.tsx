"use client";

import { useState } from "react";

type StockValues = {
  qtyAvailable: number;
  qtyReserved: number;
  qtyInTransit: number;
};

export default function StockCell({
  productId,
  warehouseId,
  initial,
}: {
  productId: string;
  warehouseId: string;
  initial: StockValues | null;
}) {
  const [values, setValues] = useState<StockValues>(
    initial ?? { qtyAvailable: 0, qtyReserved: 0, qtyInTransit: 0 }
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(values);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(values);
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const res = await fetch("/api/stock/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        warehouseId,
        qtyAvailable: draft.qtyAvailable,
        qtyReserved: draft.qtyReserved,
        qtyInTransit: draft.qtyInTransit,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка сохранения");
      return;
    }

    setValues(draft);
    setEditing(false);
  }

  if (editing) {
    return (
      <td style={{ minWidth: 150 }}>
        {error && <div className="error">{error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <input
            type="number"
            title="Доступно"
            value={draft.qtyAvailable}
            onChange={(e) =>
              setDraft((d) => ({ ...d, qtyAvailable: Number(e.target.value) }))
            }
            style={{ width: "100%" }}
          />
          <div style={{ display: "flex", gap: 4 }}>
            <input
              type="number"
              title="В резерве"
              value={draft.qtyReserved}
              onChange={(e) =>
                setDraft((d) => ({ ...d, qtyReserved: Number(e.target.value) }))
              }
              style={{ width: "50%" }}
            />
            <input
              type="number"
              title="В пути"
              value={draft.qtyInTransit}
              onChange={(e) =>
                setDraft((d) => ({ ...d, qtyInTransit: Number(e.target.value) }))
              }
              style={{ width: "50%" }}
            />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "…" : "Сохранить"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              Отмена
            </button>
          </div>
        </div>
      </td>
    );
  }

  return (
    <td
      onClick={startEdit}
      style={{ cursor: "pointer", minWidth: 90 }}
      title="Нажмите, чтобы изменить"
    >
      <strong>{values.qtyAvailable}</strong>
      {(values.qtyReserved > 0 || values.qtyInTransit > 0) && (
        <div className="muted">
          рез. {values.qtyReserved} · путь {values.qtyInTransit}
        </div>
      )}
    </td>
  );
}
