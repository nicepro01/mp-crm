import Papa from "papaparse";
import { prisma } from "./prisma";

// Performance API Ozon — отдельный сервис от Seller API (свои Client-Id/
// Client-Secret, отдельная авторизация через OAuth client_credentials).
// Нужен, чтобы получить РЕАЛЬНЫЙ расход на рекламу по каждому SKU — в фидах
// Seller API ("Оплата за клик", "Продвижение с оплатой за заказ") эти
// операции не несут sku вообще (проверено эмпирически), поэтому раньше весь
// расход на клики падал в общий "unattributed" котёл и размазывался по всем
// товарам пропорционально выручке вместо реальной привязки.
const PERF_BASE_URL = "https://api-performance.ozon.ru";

export type OzonPerformanceCredentials = { perfClientId: string; perfClientSecret: string };

async function getPerformanceCredentials(marketplaceId: string): Promise<OzonPerformanceCredentials | null> {
  const marketplace = await prisma.marketplace.findUniqueOrThrow({ where: { id: marketplaceId } });
  const credentials = marketplace.credentials as Record<string, string> | null | undefined;
  if (!credentials?.perfClientId || !credentials?.perfClientSecret) return null;
  return { perfClientId: credentials.perfClientId, perfClientSecret: credentials.perfClientSecret };
}

async function getPerformanceToken(creds: OzonPerformanceCredentials): Promise<string> {
  const res = await fetch(`${PERF_BASE_URL}/api/client/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: creds.perfClientId,
      client_secret: creds.perfClientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ozon Performance API: не удалось получить токен (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.access_token as string;
}

type PerfCampaign = { id: string; advObjectType: string };

// Только SKU-кампании (оплата за клик по товару) — "Продвижение бренда" уже
// приходит с sku напрямую в Seller API и здесь не нужно, остальные типы
// (баннеры, блогеры, VK) не относятся к товарной рекламе.
async function fetchSkuCampaignIds(token: string): Promise<string[]> {
  const res = await fetch(`${PERF_BASE_URL}/api/client/campaign`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ozon Performance API: список кампаний вернул ${res.status}: ${text.slice(0, 300)}`);
  }
  const data: { list: PerfCampaign[] } = await res.json();
  return data.list.filter((c) => c.advObjectType === "SKU").map((c) => c.id);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Расход по SKU из одного CSV-отчёта (одна кампания за период) — формат:
// строка-заголовок отчёта, строка с колонками, строки по дням/sku, "Всего".
function parseSpendCsv(text: string, out: Map<number, number>) {
  const clean = text.replace(/^﻿/, "");
  const rows = Papa.parse<string[]>(clean, { delimiter: ";" }).data as string[][];
  const headerIdx = rows.findIndex((r) => r[0] === "День");
  if (headerIdx === -1) return;
  const header = rows[headerIdx];
  const skuIdx = header.indexOf("sku");
  const spendIdx = header.indexOf("Расход, ₽, с НДС");
  if (skuIdx === -1 || spendIdx === -1) return;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[0] === "Всего" || row[0] === "") continue;
    const sku = parseInt(row[skuIdx], 10);
    if (!sku) continue;
    const spend = parseFloat((row[spendIdx] ?? "0").replace(",", ".")) || 0;
    out.set(sku, (out.get(sku) ?? 0) + spend);
  }
}

// Отчёт по одной кампании скачивается как голый CSV, по нескольким сразу —
// как ZIP с одним CSV на кампанию (оба варианта проверены эмпирически).
async function parseReportBuffer(buffer: Buffer, out: Map<number, number>) {
  const isZip = buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (!isZip) {
    parseSpendCsv(buffer.toString("utf-8"), out);
    return;
  }
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  for (const file of Object.values(zip.files)) {
    if (file.dir || !file.name.endsWith(".csv")) continue;
    const text = await file.async("string");
    parseSpendCsv(text, out);
  }
}

async function requestAndDownloadReport(
  token: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string
): Promise<Buffer> {
  const createRes = await fetch(`${PERF_BASE_URL}/api/client/statistics`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ campaigns: campaignIds, dateFrom, dateTo, groupBy: "DATE" }),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`Ozon Performance API: создание отчёта вернуло ${createRes.status}: ${text.slice(0, 300)}`);
  }
  const { UUID } = await createRes.json();

  // Генерация обычно занимает 5-10с — опрашиваем статус с паузой, не чаще.
  let ready = false;
  for (let attempt = 0; attempt < 20 && !ready; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(`${PERF_BASE_URL}/api/client/statistics/${UUID}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!statusRes.ok) continue;
    const status = await statusRes.json();
    if (status.state === "OK") ready = true;
    else if (status.state === "ERROR") {
      throw new Error(`Ozon Performance API: отчёт по кампаниям ${campaignIds.join(",")} завершился с ошибкой`);
    }
  }
  if (!ready) {
    throw new Error(`Ozon Performance API: отчёт по кампаниям ${campaignIds.join(",")} не сгенерировался за отведённое время`);
  }

  const reportRes = await fetch(`${PERF_BASE_URL}/api/client/statistics/report?UUID=${UUID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!reportRes.ok) {
    throw new Error(`Ozon Performance API: скачивание отчёта вернуло ${reportRes.status}`);
  }
  return Buffer.from(await reportRes.arrayBuffer());
}

const MAX_CAMPAIGNS_PER_REPORT = 10;

/**
 * Реальный расход на рекламу по каждому Ozon SKU (числовой sku площадки, тот
 * же, что в fetchOzonStocks/fetchOzonFinanceTransactions) за период — сумма
 * "Расход, ₽, с НДС" по всем SKU-кампаниям. null — Performance API credentials
 * не настроены для этого магазина (см. «Настройки → Интеграции»), вызывающий
 * код должен в этом случае оставить старое поведение (общий unattributed
 * котёл), а не считать расход нулевым.
 */
export async function fetchOzonPerformanceAdSpendBySku(
  marketplaceId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<Map<number, number> | null> {
  const creds = await getPerformanceCredentials(marketplaceId);
  if (!creds) return null;

  const token = await getPerformanceToken(creds);
  const campaignIds = await fetchSkuCampaignIds(token);

  const spendBySku = new Map<number, number>();
  if (campaignIds.length === 0) return spendBySku;

  const fromStr = dateFrom.toISOString().slice(0, 10);
  const toStr = dateTo.toISOString().slice(0, 10);

  // Магазин с активной рекламой может иметь сотни SKU-кампаний (напр. 326 —
  // 33 батча по 10) — последовательно это упирается в лимит времени
  // серверлесс-функции (проверено эмпирически: 13 батчей уложились в 300с,
  // 33 уже нет). Генерация отчёта у Ozon асинхронная и независимая на
  // батч, поэтому гоняем все батчи параллельно; сбой одного батча не должен
  // терять данные по остальным — это дополнительные данные, а не
  // единственный источник (без них просто останется старое поведение
  // через unattributed-котёл для этих SKU).
  const batches = chunk(campaignIds, MAX_CAMPAIGNS_PER_REPORT);
  const results = await Promise.allSettled(
    batches.map((batch) => requestAndDownloadReport(token, batch, fromStr, toStr))
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      await parseReportBuffer(result.value, spendBySku);
    } else {
      console.error("Ozon Performance API: батч отчёта не удался:", result.reason);
    }
  }

  return spendBySku;
}
