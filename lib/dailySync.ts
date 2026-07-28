import { syncWbUnitEconomics, syncOzonUnitEconomics, syncYandexUnitEconomics } from "./unitEconomicsSync";
import { syncWbStockImport, syncOzonStockImport, syncYandexStockImport } from "./stockImportSync";
import { syncWbReturns } from "./returnsSync";
import { syncWbDailyFunnel, syncOzonDailyFunnel, syncYandexFunnelBackfill } from "./marketplaceFunnelSync";
import { syncSeasonalityFromWb, syncSeasonalityFromOzon, syncSeasonalityFromYandexMarket } from "./seasonalitySync";

export type SubSyncResult = { ok: true; data: unknown } | { ok: false; error: string };
export type FullMarketplaceSyncResult = Record<string, SubSyncResult>;

// Один упавший под-синк (например, площадка ещё не настроена для этой
// компании) не должен обрывать остальные — конфигурация нескольких площадок
// у одной компании независима друг от друга.
async function tryRun(fn: () => Promise<unknown>): Promise<SubSyncResult> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "неизвестная ошибка" };
  }
}

// Все применимые к WB синки сразу — вызывается изнутри уже установленного
// runWithTenant()-контекста (см. app/api/daily-sync/wb/route.ts и
// app/api/cron/wb/route.ts), сам с сессией/компанией не работает.
export async function runFullWbSync(): Promise<FullMarketplaceSyncResult> {
  return {
    unitEconomics: await tryRun(() => syncWbUnitEconomics()),
    funnel: await tryRun(() => syncWbDailyFunnel()),
    seasonality: await tryRun(() => syncSeasonalityFromWb()),
    stockImport: await tryRun(() => syncWbStockImport()),
    returns: await tryRun(() => syncWbReturns()),
  };
}

export async function runFullOzonSync(): Promise<FullMarketplaceSyncResult> {
  return {
    unitEconomics: await tryRun(() => syncOzonUnitEconomics()),
    funnel: await tryRun(() => syncOzonDailyFunnel()),
    seasonality: await tryRun(() => syncSeasonalityFromOzon()),
    stockImport: await tryRun(() => syncOzonStockImport()),
  };
}

export async function runFullYandexSync(): Promise<FullMarketplaceSyncResult> {
  return {
    unitEconomics: await tryRun(() => syncYandexUnitEconomics()),
    // monthsBack=1 — тот же последний завершённый месяц, что и у ручной
    // кнопки в FunnelChartWidget.tsx; ежедневный запуск просто пересчитывает
    // его заново (площадка не даёт дневную детализацию, см. лимитацию в
    // lib/marketplaceFunnelSync.ts).
    funnel: await tryRun(() => syncYandexFunnelBackfill(1)),
    seasonality: await tryRun(() => syncSeasonalityFromYandexMarket()),
    stockImport: await tryRun(() => syncYandexStockImport()),
  };
}
