"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import ProductPicker from "@/app/components/ProductPicker";
import PhotoThumb from "@/app/products/PhotoThumb";
import { EditIconButton, SaveIconButton, CancelIconButton, DeleteIconButton } from "@/app/components/RowIconActions";

type Product = {
  id: string;
  sku: string;
  name: string;
  photoUrl: string | null;
  unitsPerBox: number;
  boxWeightKg: string;
  boxLengthMm: number;
  boxWidthMm: number;
  boxHeightMm: number;
};

type Supplier = { id: string; name: string };

type UnitCost = {
  productCostRub: string;
  logisticsCostRub: string;
  landedCostRub: string;
};

type BatchItem = {
  id: string;
  qty: number;
  purchasePriceRub: string;
  product: Product;
  supplier: Supplier | null;
  unitCost: UnitCost | null;
};

function calcItem(qty: number, product: Product) {
  const boxesNeeded = Math.ceil(qty / product.unitsPerBox);
  const boxWeightKg = Number(product.boxWeightKg);
  const boxVolumeM3 =
    (product.boxLengthMm * product.boxWidthMm * product.boxHeightMm) / 1_000_000_000;

  return {
    boxesNeeded,
    totalWeightKg: boxWeightKg * boxesNeeded,
    totalVolumeM3: boxVolumeM3 * boxesNeeded,
  };
}

function fmt(n: number) {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

export default function BatchItemsSection({
  batchId,
  products,
  items,
}: {
  batchId: string;
  products: Product[];
  items: BatchItem[];
}) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("");
  const [purchasePriceRub, setPurchasePriceRub] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const selectedProduct = products.find((p) => p.id === productId) ?? null;
  const qtyNum = Number(qty) || 0;
  const priceNum = Number(purchasePriceRub) || 0;
  const preview = selectedProduct && qtyNum > 0 ? calcItem(qtyNum, selectedProduct) : null;
  const lineTotal = qtyNum * priceNum;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!productId) {
      setError("Выберите товар");
      return;
    }
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/batches/${batchId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        qty: qtyNum,
        purchasePriceRub,
      }),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка сохранения");
      return;
    }

    setProductId("");
    setQty("");
    setPurchasePriceRub("");
    router.refresh();
  }

  function startEdit(item: BatchItem) {
    setEditingId(item.id);
    setEditQty(String(item.qty));
    setEditPrice(item.purchasePriceRub);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSaveEdit(itemId: string) {
    setEditSaving(true);
    setEditError(null);

    const res = await fetch(`/api/batch-items/${itemId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qty: Number(editQty),
        purchasePriceRub: editPrice,
      }),
    });

    setEditSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setEditError(body.error ?? "Не удалось сохранить");
      return;
    }

    setEditingId(null);
    router.refresh();
  }

  const summary = useMemo(() => {
    let totalBoxes = 0;
    let totalWeightKg = 0;
    let totalVolumeM3 = 0;
    let totalAmountRub = 0;

    for (const item of items) {
      const calc = calcItem(item.qty, item.product);
      totalBoxes += calc.boxesNeeded;
      totalWeightKg += calc.totalWeightKg;
      totalVolumeM3 += calc.totalVolumeM3;
      totalAmountRub += item.qty * Number(item.purchasePriceRub);
    }

    return { totalBoxes, totalWeightKg, totalVolumeM3, totalAmountRub };
  }, [items]);

  return (
    <div style={{ marginTop: 32 }}>
      <h1>Позиции поставки</h1>

      {items.length === 0 ? (
        <p className="muted">Пока нет ни одной позиции.</p>
      ) : (
        <>
          <div className="table-scroll" style={{ marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 60 }}></th>
                  <th>SKU</th>
                  <th>Товар</th>
                  <th>Поставщик</th>
                  <th>Кол-во</th>
                  <th>Цена за шт, ₽</th>
                  <th>Сумма, ₽</th>
                  <th>Коробок</th>
                  <th>Вес, кг</th>
                  <th>Объём, м³</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isEditing = editingId === item.id;
                  const displayQty = isEditing ? Number(editQty) || 0 : item.qty;
                  const displayPrice = isEditing ? Number(editPrice) || 0 : Number(item.purchasePriceRub);
                  const calc = calcItem(displayQty, item.product);
                  const lineAmount = displayQty * displayPrice;
                  return (
                    <tr key={item.id}>
                      <td>
                        <PhotoThumb url={item.product.photoUrl} size={88} />
                      </td>
                      <td>{item.product.sku}</td>
                      <td>{item.product.name}</td>
                      <td>{item.supplier?.name ?? "—"}</td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            style={{ width: 90 }}
                          />
                        ) : (
                          item.qty
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
                            style={{ width: 100 }}
                          />
                        ) : (
                          item.purchasePriceRub
                        )}
                      </td>
                      <td>
                        <strong>{fmt(lineAmount)}</strong>
                      </td>
                      <td>{calc.boxesNeeded}</td>
                      <td>{fmt(calc.totalWeightKg)}</td>
                      <td>{fmt(calc.totalVolumeM3)}</td>
                      <td className="row-actions">
                        {isEditing ? (
                          <>
                            <SaveIconButton onClick={() => handleSaveEdit(item.id)} disabled={editSaving} />
                            <CancelIconButton onClick={cancelEdit} />
                          </>
                        ) : (
                          <>
                            <EditIconButton onClick={() => startEdit(item)} />
                            <DeleteIconButton
                              endpoint={`/api/batch-items/${item.id}`}
                              confirmMessage="Удалить эту позицию поставки?"
                            />
                          </>
                        )}
                        {isEditing && editError && (
                          <div className="error" style={{ fontSize: 12 }}>
                            {editError}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            className="muted"
            style={{
              background: "var(--surface-alt)",
              padding: "10px 12px",
              borderRadius: 6,
              fontSize: 14,
              marginBottom: 20,
            }}
          >
            Итого по поставке: <strong>{summary.totalBoxes}</strong> кор. ·{" "}
            <strong>{fmt(summary.totalWeightKg)}</strong> кг ·{" "}
            <strong>{fmt(summary.totalVolumeM3)}</strong> м³ ·{" "}
            <strong>{fmt(summary.totalAmountRub)}</strong> ₽
          </div>
        </>
      )}

      <form onSubmit={handleAdd} style={{ maxWidth: 480 }}>
        <div className="muted">Добавить позицию</div>
        {error && <div className="error">{error}</div>}

        <label>
          Товар *
          <ProductPicker products={products} value={productId} onChange={setProductId} />
        </label>

        <label>
          Заказанное количество *
          <input
            required
            type="number"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>

        {preview && (
          <div className="muted">
            Коробок: <strong>{preview.boxesNeeded}</strong> · Вес:{" "}
            <strong>{fmt(preview.totalWeightKg)}</strong> кг · Объём:{" "}
            <strong>{fmt(preview.totalVolumeM3)}</strong> м³
          </div>
        )}

        <label>
          Закупочная цена за 1 шт, ₽ *
          <input
            required
            type="number"
            step="0.01"
            value={purchasePriceRub}
            onChange={(e) => setPurchasePriceRub(e.target.value)}
          />
        </label>

        {lineTotal > 0 && (
          <div className="muted">
            Сумма позиции: <strong>{fmt(lineTotal)}</strong> ₽
          </div>
        )}

        <div className="actions">
          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Сохранение…" : "Добавить"}
          </button>
        </div>
      </form>
    </div>
  );
}
