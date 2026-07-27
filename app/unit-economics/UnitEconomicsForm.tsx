"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Product = { id: string; sku: string; name: string };

type FormValues = {
  id?: string;
  productId: string;
  marketplace: string;
  periodMonth: string;
  cogsRub: string;
  inboundLogisticsRub: string;
  mpCommissionRub: string;
  mpLogisticsRub: string;
  storageRub: string;
  adsRub: string;
  taxRub: string;
  laborAllocRub: string;
  sellPriceRub: string;
};

const emptyValues: FormValues = {
  productId: "",
  marketplace: "",
  periodMonth: new Date().toISOString().slice(0, 7),
  cogsRub: "",
  inboundLogisticsRub: "",
  mpCommissionRub: "",
  mpLogisticsRub: "",
  storageRub: "",
  adsRub: "0",
  taxRub: "",
  laborAllocRub: "0",
  sellPriceRub: "",
};

const marketplaceLabels: Record<string, string> = {
  "": "Все площадки / не указано",
  WB: "Wildberries",
  OZON: "Ozon",
  YANDEX_MARKET: "Яндекс.Маркет",
};

const fifoSourceLabels: Record<string, string> = {
  fifo: "по факту продаж за период",
  latest_batch: "по последней поставке",
  none: "нет данных",
};

type CostOptions = {
  purchase: string | null;
  fifo: string | null;
  fifoLabel: string;
};

function n(v: string) {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function UnitEconomicsForm({
  products,
  initial,
}: {
  products: Product[];
  initial?: Partial<FormValues>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    ...emptyValues,
    ...initial,
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [costOptions, setCostOptions] = useState<CostOptions | null>(null);

  const isEdit = Boolean(values.id);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  async function handleSuggest() {
    if (!values.productId || !values.periodMonth) {
      setSuggestNote("Сначала выберите товар и период");
      return;
    }
    setSuggesting(true);
    setSuggestNote(null);
    setCostOptions(null);

    const qs = new URLSearchParams({
      productId: values.productId,
      periodMonth: values.periodMonth,
    });
    if (values.marketplace) qs.set("marketplace", values.marketplace);

    const res = await fetch(`/api/unit-economics/suggest?${qs.toString()}`);
    const body = await res.json();
    setSuggesting(false);

    const notes: string[] = [];

    if (body.purchasePriceRub || body.fifo?.cogsRub) {
      setCostOptions({
        purchase: body.purchasePriceRub ?? null,
        fifo: body.fifo?.cogsRub ?? null,
        fifoLabel: fifoSourceLabels[body.fifo?.source as string] ?? "",
      });
      notes.push("выберите себестоимость ниже — закупочную цену или точную по FIFO");
    } else {
      notes.push(
        "себестоимость не найдена ни в закупочной цене, ни по поставкам — введите вручную"
      );
    }

    if (body.listing) {
      if (body.listing.mpCommissionRub) {
        set("mpCommissionRub", body.listing.mpCommissionRub);
      }
      if (body.listing.mpLogisticsRub) {
        set("mpLogisticsRub", body.listing.mpLogisticsRub);
      }
      if (body.listing.storageRub) {
        set("storageRub", body.listing.storageRub);
      }
      if (body.listing.sellPriceRub) {
        set("sellPriceRub", body.listing.sellPriceRub);
      }
      notes.push(
        `комиссия/логистика МП/хранение/цена — из листинга ${body.listing.mpSku}`
      );
    } else if (values.marketplace) {
      notes.push("листинг товара на этой площадке не найден — заполните вручную");
    }

    setSuggestNote(notes.join("; "));
  }

  const totalCosts =
    n(values.cogsRub) +
    n(values.inboundLogisticsRub) +
    n(values.mpCommissionRub) +
    n(values.mpLogisticsRub) +
    n(values.storageRub) +
    n(values.adsRub) +
    n(values.taxRub) +
    n(values.laborAllocRub);
  const sellPrice = n(values.sellPriceRub);
  const previewMarginRub = sellPrice - totalCosts;
  const previewMarginPct = sellPrice > 0 ? (previewMarginRub / sellPrice) * 100 : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      productId: values.productId,
      marketplace: values.marketplace || null,
      periodMonth: values.periodMonth,
      cogsRub: values.cogsRub,
      inboundLogisticsRub: values.inboundLogisticsRub,
      mpCommissionRub: values.mpCommissionRub,
      mpLogisticsRub: values.mpLogisticsRub,
      storageRub: values.storageRub,
      adsRub: values.adsRub || "0",
      taxRub: values.taxRub,
      laborAllocRub: values.laborAllocRub || "0",
      sellPriceRub: values.sellPriceRub,
    };

    const url = isEdit ? `/api/unit-economics/${values.id}` : "/api/unit-economics";
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

    router.push("/unit-economics");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 640 }}>
      {error && <div className="error">{error}</div>}

      <div className="row">
        <label>
          Товар *
          <select
            required
            value={values.productId}
            onChange={(e) => set("productId", e.target.value)}
          >
            <option value="" disabled>
              Выберите товар
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Площадка
          <select
            value={values.marketplace}
            onChange={(e) => set("marketplace", e.target.value)}
          >
            {Object.entries(marketplaceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        Период (месяц) *
        <input
          required
          type="month"
          value={values.periodMonth}
          onChange={(e) => set("periodMonth", e.target.value)}
        />
      </label>

      <div className="actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleSuggest}
          disabled={suggesting}
        >
          {suggesting ? "Считаю…" : "Подставить из данных (FIFO + листинг МП)"}
        </button>
      </div>
      {suggestNote && <div className="muted">{suggestNote}</div>}

      <div className="muted">Расходы на юнит, ₽</div>

      <label>
        Себестоимость (COGS) *
        <input
          required
          type="number"
          step="0.01"
          value={values.cogsRub}
          onChange={(e) => set("cogsRub", e.target.value)}
        />
      </label>

      {costOptions && (costOptions.purchase || costOptions.fifo) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: -8 }}>
          {costOptions.purchase && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => set("cogsRub", costOptions.purchase!)}
            >
              Закупочная цена: {costOptions.purchase} ₽
            </button>
          )}
          {costOptions.fifo && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: 12, padding: "4px 10px" }}
              onClick={() => set("cogsRub", costOptions.fifo!)}
            >
              FIFO: {costOptions.fifo} ₽ ({costOptions.fifoLabel})
            </button>
          )}
        </div>
      )}

      <div className="row">
        <label>
          Логистика до склада *
          <input
            required
            type="number"
            step="0.01"
            value={values.inboundLogisticsRub}
            onChange={(e) => set("inboundLogisticsRub", e.target.value)}
          />
        </label>
        <label>
          Комиссия МП *
          <input
            required
            type="number"
            step="0.01"
            value={values.mpCommissionRub}
            onChange={(e) => set("mpCommissionRub", e.target.value)}
          />
        </label>
      </div>

      <div className="row">
        <label>
          Логистика МП *
          <input
            required
            type="number"
            step="0.01"
            value={values.mpLogisticsRub}
            onChange={(e) => set("mpLogisticsRub", e.target.value)}
          />
        </label>
        <label>
          Хранение *
          <input
            required
            type="number"
            step="0.01"
            value={values.storageRub}
            onChange={(e) => set("storageRub", e.target.value)}
          />
        </label>
      </div>

      <div className="row">
        <label>
          Реклама
          <input
            type="number"
            step="0.01"
            value={values.adsRub}
            onChange={(e) => set("adsRub", e.target.value)}
          />
        </label>
        <label>
          Налог *
          <input
            required
            type="number"
            step="0.01"
            value={values.taxRub}
            onChange={(e) => set("taxRub", e.target.value)}
          />
        </label>
      </div>

      <div className="row">
        <label>
          Доля ФОТ
          <input
            type="number"
            step="0.01"
            value={values.laborAllocRub}
            onChange={(e) => set("laborAllocRub", e.target.value)}
          />
        </label>
        <label>
          Цена продажи *
          <input
            required
            type="number"
            step="0.01"
            value={values.sellPriceRub}
            onChange={(e) => set("sellPriceRub", e.target.value)}
          />
        </label>
      </div>

      <div
        className="muted"
        style={{
          background: "var(--surface-alt)",
          padding: "10px 12px",
          borderRadius: 6,
          fontSize: 14,
        }}
      >
        Итого расходов: {totalCosts.toFixed(2)} ₽ · Маржа:{" "}
        <strong style={{ color: previewMarginRub >= 0 ? "#16a34a" : "#dc2626" }}>
          {previewMarginRub.toFixed(2)} ₽ ({previewMarginPct.toFixed(1)}%)
        </strong>
      </div>

      <div className="actions">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Сохранение…" : isEdit ? "Сохранить" : "Создать"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => router.push("/unit-economics")}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
