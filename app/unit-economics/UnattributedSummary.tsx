type Breakdown = Record<string, { amount: number; count: number }>;

export type UnattributedSnapshot = {
  amountRub: number;
  operations: number;
  syncedAt: string | null;
  breakdown: Breakdown | null;
};

// Статичный снимок расходов площадки, которые синк не смог привязать ни к
// одному товару (см. sync-ozon/sync-yandex) — читается из БД на каждой
// загрузке страницы, поэтому обновляется сам после любого синка (через
// router.refresh() в AllMarketplacesSyncForm), без собственного состояния.
export default function UnattributedSummary({ data }: { data: UnattributedSnapshot | null }) {
  if (!data || data.operations === 0) return null;

  return (
    <div
      className="muted"
      style={{ background: "var(--surface-alt)", padding: "10px 12px", borderRadius: 6, marginBottom: 16 }}
      title="Площадка не даёт привязки этих операций ни к одному конкретному товару (напр. реклама без SKU, подписка, кросс-докинг) — разнести их по товарам нельзя. Показано отдельно, чтобы деньги не терялись молча."
    >
      Расходы без привязки к товару за период: {data.amountRub.toLocaleString("ru-RU")} ₽ (
      {data.operations} операций)
      {data.syncedAt && <span> · по состоянию на {new Date(data.syncedAt).toLocaleString("ru-RU")}</span>}
      {data.breakdown && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
          {Object.entries(data.breakdown).map(([category, { amount, count }]) => (
            <li key={category}>
              {category}: {amount.toLocaleString("ru-RU")} ₽ ({count})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
