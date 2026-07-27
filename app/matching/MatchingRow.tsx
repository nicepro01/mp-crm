"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import PhotoThumb from "@/app/products/PhotoThumb";

type Product = { id: string; sku: string; name: string; photoUrl: string | null };

export default function MatchingRow({
  item,
  products,
}: {
  item: {
    id: string;
    mpSku: string;
    barcode: string | null;
    name: string | null;
    marketplaceName: string;
  };
  products: Product[];
}) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMatch() {
    if (!productId) {
      setError("Выберите товар");
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/matching/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "match", productId }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка");
      return;
    }

    router.refresh();
  }

  async function handleIgnore() {
    if (!confirm("Игнорировать эту запись? Она уйдёт из списка несопоставленных.")) {
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/matching/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore" }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка");
      return;
    }

    router.refresh();
  }

  const newProductParams = new URLSearchParams({
    sku: item.mpSku,
    returnTo: "/matching",
    matchItemId: item.id,
  });
  if (item.barcode) newProductParams.set("barcode", item.barcode);
  if (item.name) newProductParams.set("name", item.name);

  // Пока карточка МП не привязана к товару, фото самой площадки у нас нет
  // (MpImportItem его не хранит) — показываем фото ВЫБРАННОГО в селекте
  // товара, чтобы можно было сверить визуально перед тем, как жать
  // "Привязать", а не только по названию/SKU.
  const selectedProduct = products.find((p) => p.id === productId);

  return (
    <tr>
      <td>
        <PhotoThumb url={selectedProduct?.photoUrl ?? null} size={72} />
      </td>
      <td>{item.marketplaceName}</td>
      <td style={{ fontSize: 16, fontWeight: 600 }}>{item.mpSku}</td>
      <td>{item.barcode ?? "—"}</td>
      <td>{item.name ?? "—"}</td>
      <td style={{ minWidth: 260 }}>
        {error && <div className="error">{error}</div>}
        <div style={{ display: "flex", gap: 6 }}>
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Выберите товар…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            onClick={handleMatch}
            disabled={saving}
            style={{ whiteSpace: "nowrap" }}
          >
            Привязать
          </button>
        </div>
        <div className="actions" style={{ marginTop: 6 }}>
          <a href={`/products/new?${newProductParams.toString()}`}>
            + Создать новый товар
          </a>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleIgnore}
            disabled={saving}
          >
            Игнорировать
          </button>
        </div>
      </td>
    </tr>
  );
}
