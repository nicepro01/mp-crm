// Фоновый автосинк истории продаж (сезонность) — работает, пока запущен
// сервер (npm run dev / npm start). Раз в сутки, без участия пользователя.
// register() вызывается один раз при старте Node-процесса Next.js.
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // раз в сутки

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { syncSeasonalityFromWb, syncSeasonalityFromOzon, syncSeasonalityFromYandexMarket } = await import(
    "@/lib/seasonalitySync"
  );

  async function runSync() {
    if (process.env.WB_API_TOKEN) {
      try {
        const summary = await syncSeasonalityFromWb();
        console.log(
          `[seasonality] автосинк WB: загружено ${summary.salesFetched}, сопоставлено ${summary.matched}, обновлено месяцев ${summary.monthsUpserted}`
        );
      } catch (err: any) {
        console.error("[seasonality] автосинк WB не удался:", err.message ?? err);
      }
    }

    if (process.env.OZON_CLIENT_ID && process.env.OZON_API_KEY) {
      try {
        const summary = await syncSeasonalityFromOzon();
        console.log(
          `[seasonality] автосинк Ozon: загружено ${summary.salesFetched}, сопоставлено ${summary.matched}, обновлено месяцев ${summary.monthsUpserted}`
        );
      } catch (err: any) {
        console.error("[seasonality] автосинк Ozon не удался:", err.message ?? err);
      }
    }

    // Отчёт Yandex Market жёстко ограничен 1 запросом генерации в 10 минут
    // на бизнес — при частых перезапусках сервера в разработке это может
    // просто не пройти по лимиту, тогда синк тихо пропускается до следующего
    // раза (раз в сутки в проде лимит не мешает).
    if (process.env.YANDEX_MARKET_TOKEN) {
      try {
        const summary = await syncSeasonalityFromYandexMarket();
        console.log(
          `[seasonality] автосинк Яндекс.Маркет: загружено ${summary.salesFetched}, сопоставлено ${summary.matched}, обновлено месяцев ${summary.monthsUpserted}`
        );
      } catch (err: any) {
        console.error("[seasonality] автосинк Яндекс.Маркет не удался:", err.message ?? err);
      }
    }
  }

  // Первый прогон — сразу при старте сервера (не блокируя запуск), дальше — по расписанию.
  runSync();
  setInterval(runSync, SYNC_INTERVAL_MS);
}
