import type { Marketplace } from "@prisma/client";
import { prisma } from "./prisma";
import { syncWbUnitEconomics, syncOzonUnitEconomics, syncYandexUnitEconomics } from "./unitEconomicsSync";
import { syncWbStockImport, syncOzonStockImport, syncYandexStockImport } from "./stockImportSync";
import { syncWbReturns } from "./returnsSync";
import { syncWbDailyFunnel, syncOzonDailyFunnel, syncYandexFunnelBackfill } from "./marketplaceFunnelSync";
import { syncSeasonalityFromWb, syncSeasonalityFromOzon, syncSeasonalityFromYandexMarket } from "./seasonalitySync";

export type SubSyncResult = { ok: true; data: unknown } | { ok: false; error: string };
export type MarketplaceSyncResult = { name: string; results: Record<string, SubSyncResult> };
// Ключ верхнего уровня — marketplaceId, а не код: у компании может быть
// несколько строк Marketplace одного кода (напр. два магазина Ozon), каждая
// синкается и отчитывается независимо.
export type FullMarketplaceSyncResult = Record<string, MarketplaceSyncResult>;

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

// Все применимые к WB синки сразу, по КАЖДОЙ строке Marketplace с code=WB у
// текущей компании (обычно одна, но может быть несколько) — вызывается
// изнутри уже установленного runWithTenant()-контекста (см.
// app/api/daily-sync/wb/route.ts и app/api/cron/wb/route.ts), сам с
// сессией/компанией не работает.
export async function runFullWbSync(): Promise<FullMarketplaceSyncResult> {
  const rows = await prisma.marketplace.findMany({ where: { code: "WB" } });
  // Магазины одного кода синкаются ПАРАЛЛЕЛЬНО (не по очереди) — каждый
  // магазин это независимый API-аккаунт, конкуренции за общий рейт-лимит
  // между ними нет. Последовательно остаются только под-синки ВНУТРИ одного
  // магазина (см. комментарии в lib/unitEconomicsSync.ts про обрыв
  // соединения при Promise.all тяжёлых запросов). Без этого второй магазин
  // той же площадки удваивает общее время и упирается в лимит Vercel (300с
  // на Hobby) — реальный инцидент, не гипотеза.
  const entries = await Promise.all(
    rows.map(async (marketplace) => {
      const results = {
        unitEconomics: await tryRun(() => syncWbUnitEconomics(marketplace)),
        funnel: await tryRun(() => syncWbDailyFunnel(marketplace)),
        seasonality: await tryRun(() => syncSeasonalityFromWb(marketplace)),
        stockImport: await tryRun(() => syncWbStockImport(marketplace)),
        returns: await tryRun(() => syncWbReturns(marketplace)),
      };
      return [marketplace.id, { name: marketplace.name, results }] as const;
    })
  );
  return Object.fromEntries(entries);
}

// Ozon с реальными данными (даже одного магазина) уже сам по себе близок к
// лимиту в 300с на Vercel Hobby — проверено на проде: два магазина ПАРАЛЛЕЛЬНО
// всё равно упирались в FUNCTION_INVOCATION_TIMEOUT, значит узкое место не в
// количестве магазинов, а в том, что все 4 под-синка шли один за другим
// внутри одного вызова. Поэтому для Ozon (в отличие от WB/Яндекса, которые
// пока укладываются) каждый под-синк — отдельная функция и отдельный
// cron-вызов (см. vercel.json), все на одно и то же время по ночам, но
// параллельно друг другу как отдельные serverless-функции, каждая со своим
// собственным бюджетом в 300с.
async function runOzonSubSync(
  subSyncKey: string,
  fn: (marketplace: Marketplace) => Promise<unknown>
): Promise<FullMarketplaceSyncResult> {
  const rows = await prisma.marketplace.findMany({ where: { code: "OZON" } });
  const entries = await Promise.all(
    rows.map(async (marketplace) => {
      const result = await tryRun(() => fn(marketplace));
      return [marketplace.id, { name: marketplace.name, results: { [subSyncKey]: result } }] as const;
    })
  );
  return Object.fromEntries(entries);
}

export function runOzonUnitEconomicsSync() {
  return runOzonSubSync("unitEconomics", syncOzonUnitEconomics);
}
export function runOzonFunnelSync() {
  return runOzonSubSync("funnel", (mp) => syncOzonDailyFunnel(mp));
}
export function runOzonSeasonalitySync() {
  return runOzonSubSync("seasonality", syncSeasonalityFromOzon);
}
export function runOzonStockImportSync() {
  return runOzonSubSync("stockImport", syncOzonStockImport);
}

export async function runFullYandexSync(): Promise<FullMarketplaceSyncResult> {
  const rows = await prisma.marketplace.findMany({ where: { code: "YANDEX_MARKET" } });
  const entries = await Promise.all(
    rows.map(async (marketplace) => {
      const results = {
        unitEconomics: await tryRun(() => syncYandexUnitEconomics(marketplace)),
        // monthsBack=1 — тот же последний завершённый месяц, что и у ручной
        // кнопки в FunnelChartWidget.tsx; ежедневный запуск просто пересчитывает
        // его заново (площадка не даёт дневную детализацию, см. лимитацию в
        // lib/marketplaceFunnelSync.ts).
        funnel: await tryRun(() => syncYandexFunnelBackfill(marketplace, 1)),
        seasonality: await tryRun(() => syncSeasonalityFromYandexMarket(marketplace)),
        stockImport: await tryRun(() => syncYandexStockImport(marketplace)),
      };
      return [marketplace.id, { name: marketplace.name, results }] as const;
    })
  );
  return Object.fromEntries(entries);
}
