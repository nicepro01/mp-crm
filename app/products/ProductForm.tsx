"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import PhotoThumb from "./PhotoThumb";

type Supplier = { id: string; name: string };

type ProductFormValues = {
  id?: string;
  sku: string;
  name: string;
  category: string;
  photoUrl: string;
  barcode: string;
  supplierId: string;
  itemWeightG: string;
  itemLengthMm: string;
  itemWidthMm: string;
  itemHeightMm: string;
  unitsPerBox: string;
  boxWeightKg: string;
  boxLengthMm: string;
  boxWidthMm: string;
  boxHeightMm: string;
  isActive: boolean;
  purchasePriceRub: string;
  seasonalDemandMultiplier: string;
};

const emptyValues: ProductFormValues = {
  sku: "",
  name: "",
  category: "",
  photoUrl: "",
  barcode: "",
  supplierId: "",
  itemWeightG: "",
  itemLengthMm: "",
  itemWidthMm: "",
  itemHeightMm: "",
  unitsPerBox: "",
  boxWeightKg: "",
  boxLengthMm: "",
  boxWidthMm: "",
  boxHeightMm: "",
  isActive: true,
  purchasePriceRub: "",
  seasonalDemandMultiplier: "1",
};

export default function ProductForm({
  initial,
  returnTo,
  suppliers = [],
  matchItemId,
}: {
  initial?: Partial<ProductFormValues>;
  returnTo?: string;
  suppliers?: Supplier[];
  matchItemId?: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProductFormValues>({
    ...emptyValues,
    ...initial,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const isEdit = Boolean(values.id);

  function set<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    setUploading(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setUploadError(body.error ?? "Не удалось загрузить фото");
      return;
    }

    const body = await res.json();
    set("photoUrl", body.url);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      sku: values.sku,
      name: values.name,
      category: values.category || null,
      photoUrl: values.photoUrl || null,
      barcode: values.barcode || null,
      supplierId: values.supplierId || null,
      itemWeightG: values.itemWeightG,
      itemLengthMm: Number(values.itemLengthMm),
      itemWidthMm: Number(values.itemWidthMm),
      itemHeightMm: Number(values.itemHeightMm),
      unitsPerBox: Number(values.unitsPerBox),
      boxWeightKg: values.boxWeightKg,
      boxLengthMm: Number(values.boxLengthMm),
      boxWidthMm: Number(values.boxWidthMm),
      boxHeightMm: Number(values.boxHeightMm),
      isActive: values.isActive,
      purchasePriceRub: values.purchasePriceRub === "" ? null : values.purchasePriceRub,
      seasonalDemandMultiplier: values.seasonalDemandMultiplier === "" ? 1 : Number(values.seasonalDemandMultiplier),
    };

    const url = isEdit ? `/api/products/${values.id}` : "/api/products";
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSaving(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Ошибка сохранения");
      return;
    }

    const savedProduct = await res.json();

    // Товар создан из несопоставленной позиции на /matching — сразу
    // привязываем её к новому товару, чтобы не выбирать его вручную ещё раз.
    if (!isEdit && matchItemId) {
      await fetch(`/api/matching/${matchItemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "match", productId: savedProduct.id }),
      }).catch(() => {});
    }

    router.push(returnTo || "/products");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}

      <div className="row">
        <label>
          SKU *
          <input
            required
            value={values.sku}
            onChange={(e) => set("sku", e.target.value)}
          />
        </label>
        <label>
          Название *
          <input
            required
            value={values.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
      </div>

      <label>
        Категория
        <input
          value={values.category}
          onChange={(e) => set("category", e.target.value)}
        />
      </label>

      <label>
        Закупочная цена, ₽
        <input
          type="number"
          step="0.01"
          min="0"
          value={values.purchasePriceRub}
          onChange={(e) => set("purchasePriceRub", e.target.value)}
          placeholder="не задана"
        />
      </label>
      <div className="muted">
        Стартовое/ручное значение — как только по этому товару придёт поставка
        с указанной ценой, она всегда заменит то, что введено здесь.
      </div>

      <label>
        Коэффициент сезонного спроса
        <input
          type="number"
          step="0.1"
          min="0"
          value={values.seasonalDemandMultiplier}
          onChange={(e) => set("seasonalDemandMultiplier", e.target.value)}
        />
      </label>
      <div className="muted">
        1 — без поправки. Например, 1.3 перед ожидаемым ростом спроса (по
        данным Wordstat, фидбеку менеджеров и т.д.) — увеличит рекомендованное
        количество заказа в Аналитике и Планировщике поставок. На срочность
        заказа (дни до конца остатка) не влияет — та считается по факту.
      </div>

      <label>
        Основной поставщик
        <select
          value={values.supplierId}
          onChange={(e) => set("supplierId", e.target.value)}
        >
          <option value="">Не указан</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="muted">
        Автоматически подставляется при добавлении этого товара в позицию
        поставки — на практике товар почти всегда закупается у одного и того
        же поставщика.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Фото товара</span>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <PhotoThumb url={values.photoUrl || null} size={72} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFileChange}
              disabled={uploading}
            />
            {values.photoUrl && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ alignSelf: "start", padding: "4px 10px", fontSize: 12 }}
                onClick={() => set("photoUrl", "")}
              >
                Удалить фото
              </button>
            )}
          </div>
        </div>
      </div>
      {uploading && <div className="muted">Загрузка…</div>}
      {uploadError && <div className="error">{uploadError}</div>}

      <label>
        Штрихкод (EAN/UPC)
        <input
          value={values.barcode}
          onChange={(e) => set("barcode", e.target.value)}
          placeholder="напр. 4601234567890"
        />
      </label>
      <div className="muted">
        Опционально, но сильно повышает надёжность автосопоставления с
        площадками при синке (Шаг 3) и на странице «Сопоставление».
      </div>

      <div className="muted">Габариты и вес товара</div>
      <div className="row">
        <label>
          Вес, г *
          <input
            required
            type="number"
            step="0.01"
            value={values.itemWeightG}
            onChange={(e) => set("itemWeightG", e.target.value)}
          />
        </label>
        <label>
          Длина, мм *
          <input
            required
            type="number"
            value={values.itemLengthMm}
            onChange={(e) => set("itemLengthMm", e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <label>
          Ширина, мм *
          <input
            required
            type="number"
            value={values.itemWidthMm}
            onChange={(e) => set("itemWidthMm", e.target.value)}
          />
        </label>
        <label>
          Высота, мм *
          <input
            required
            type="number"
            value={values.itemHeightMm}
            onChange={(e) => set("itemHeightMm", e.target.value)}
          />
        </label>
      </div>

      <div className="muted">Упаковка (коробка)</div>
      <div className="row">
        <label>
          Штук в коробке *
          <input
            required
            type="number"
            value={values.unitsPerBox}
            onChange={(e) => set("unitsPerBox", e.target.value)}
          />
        </label>
        <label>
          Вес коробки, кг *
          <input
            required
            type="number"
            step="0.001"
            value={values.boxWeightKg}
            onChange={(e) => set("boxWeightKg", e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <label>
          Длина коробки, мм *
          <input
            required
            type="number"
            value={values.boxLengthMm}
            onChange={(e) => set("boxLengthMm", e.target.value)}
          />
        </label>
        <label>
          Ширина коробки, мм *
          <input
            required
            type="number"
            value={values.boxWidthMm}
            onChange={(e) => set("boxWidthMm", e.target.value)}
          />
        </label>
      </div>
      <div className="row">
        <label>
          Высота коробки, мм *
          <input
            required
            type="number"
            value={values.boxHeightMm}
            onChange={(e) => set("boxHeightMm", e.target.value)}
          />
        </label>
        <label>
          Активен
          <select
            value={values.isActive ? "yes" : "no"}
            onChange={(e) => set("isActive", e.target.value === "yes")}
          >
            <option value="yes">Да</option>
            <option value="no">Нет</option>
          </select>
        </label>
      </div>

      <div className="actions">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => router.push("/products")}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
