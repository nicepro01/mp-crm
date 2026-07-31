import { prisma } from "./prisma";

const YANDEX_MARKET_BASE_URL = "https://api.partner.market.yandex.ru";

// Кампании продавца (см. GET /campaigns) — FBY кампания это склад
// "Яндекс.Маркет FBO", FBS кампания — склад "Яндекс.Маркет FBS". Раньше
// были захардкожены общими на всю систему, теперь свои у каждой компании
// (см. app/settings/integrations) — хранятся в Marketplace.credentials.
// Для отчёта по продажам берём businessId, а не отдельные campaignId —
// заказы (в отличие от остатков) принадлежат ровно одной кампании, поэтому
// агрегация по бизнесу не задваивает, а даёт сразу все продажи одним
// запросом. Это важно: /reports/shows-sales/generate ограничен 1 запросом
// в 10 минут на businessId, второй отдельный запрос под FBY просто не
// пройдёт по лимиту.
export type YandexCredentials = {
  token: string;
  businessId: string;
  fbyCampaignId: string;
  fbsCampaignId: string;
};

export async function getYandexCredentials(marketplaceId: string): Promise<YandexCredentials> {
  const marketplace = await prisma.marketplace.findUniqueOrThrow({ where: { id: marketplaceId } });
  const credentials = marketplace.credentials as YandexCredentials | null | undefined;
  if (!credentials?.token || !credentials?.businessId || !credentials?.fbyCampaignId || !credentials?.fbsCampaignId) {
    throw new Error(
      `Данные Яндекс.Маркета не настроены для «${marketplace.name}» — заполните токен, businessId и ID кампаний FBY/FBS в «Настройки → Интеграции»`
    );
  }
  return credentials;
}

async function yandexHeaders(marketplaceId: string) {
  const { token } = await getYandexCredentials(marketplaceId);
  return {
    "Api-Key": token,
    "Content-Type": "application/json",
  };
}

type StocksResponse = {
  status: string;
  result: {
    paging?: { nextPageToken?: string };
    warehouses: {
      warehouseId: number;
      offers: {
        offerId: string;
        stocks: { type: string; count: number }[];
      }[];
    }[];
  };
};

type CampaignWarehouseStock = { warehouseId: number; offerId: string; qty: number };

/** Остатки кампании, БЕЗ свёртки по складам — нужно и для общего числа (см.
 * fetchYandexMarketStocks), и для разбивки по конкретному складу (см.
 * fetchYandexMarketStockByWarehouse). */
async function fetchCampaignStocksByWarehouse(marketplaceId: string, campaignId: string): Promise<CampaignWarehouseStock[]> {
  const rows: CampaignWarehouseStock[] = [];
  let pageToken: string | undefined;

  for (;;) {
    const res = await fetch(
      `${YANDEX_MARKET_BASE_URL}/campaigns/${campaignId}/offers/stocks`,
      {
        method: "POST",
        headers: await yandexHeaders(marketplaceId),
        body: JSON.stringify(pageToken ? { page_token: pageToken } : {}),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Yandex Market API вернул ${res.status}: ${text.slice(0, 300)}`);
    }
    const data: StocksResponse = await res.json();

    for (const wh of data.result.warehouses) {
      for (const offer of wh.offers) {
        const available = offer.stocks.find((s) => s.type === "AVAILABLE")?.count ?? 0;
        if (available > 0) rows.push({ warehouseId: wh.warehouseId, offerId: offer.offerId, qty: available });
      }
    }

    const next = data.result.paging?.nextPageToken;
    if (!next) break;
    pageToken = next;
  }

  return rows;
}

function sumByOfferId(rows: CampaignWarehouseStock[]): Map<string, number> {
  const qtyByOfferId = new Map<string, number>();
  for (const r of rows) qtyByOfferId.set(r.offerId, (qtyByOfferId.get(r.offerId) ?? 0) + r.qty);
  return qtyByOfferId;
}

export type YandexMarketStockRow = {
  vendorCode: string; // offerId — собственный артикул продавца
  fboQty: number;
  fbsQty: number;
};

/** Тянет остатки по FBY (наш "FBO") и FBS кампаниям, сводит по артикулу продавца. */
export async function fetchYandexMarketStocks(marketplaceId: string): Promise<YandexMarketStockRow[]> {
  const { fbyCampaignId, fbsCampaignId } = await getYandexCredentials(marketplaceId);
  const [fboRows, fbsRows] = await Promise.all([
    fetchCampaignStocksByWarehouse(marketplaceId, fbyCampaignId),
    fetchCampaignStocksByWarehouse(marketplaceId, fbsCampaignId),
  ]);
  const fboByOffer = sumByOfferId(fboRows);
  const fbsByOffer = sumByOfferId(fbsRows);

  const allOfferIds = new Set([...fboByOffer.keys(), ...fbsByOffer.keys()]);
  return [...allOfferIds].map((vendorCode) => ({
    vendorCode,
    fboQty: fboByOffer.get(vendorCode) ?? 0,
    fbsQty: fbsByOffer.get(vendorCode) ?? 0,
  }));
}

export type YandexWarehouseStockRow = {
  vendorCode: string;
  warehouseName: string; // из /warehouses по id; если склада нет в справочнике — "Склад #<id>"
  qtyAvailable: number;
};

type WarehouseListResponse = { result: { warehouses: { id: number; name: string }[] } };

async function fetchYandexWarehouseNames(marketplaceId: string): Promise<Map<number, string>> {
  const res = await fetch(`${YANDEX_MARKET_BASE_URL}/warehouses`, { headers: await yandexHeaders(marketplaceId) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Yandex Market API /warehouses вернул ${res.status}: ${text.slice(0, 300)}`);
  }
  const data: WarehouseListResponse = await res.json();
  return new Map(data.result.warehouses.map((w) => [w.id, w.name]));
}

/**
 * Остатки по каждому физическому складу отдельно (FBY + FBS вместе) — для
 * распределения поставок по городам. Продажи по складу — отдельная функция
 * fetchYandexMarketSalesByWarehouse() ниже (через /orders, не через
 * рейт-лимитированный отчёт shows-sales).
 */
export async function fetchYandexMarketStockByWarehouse(marketplaceId: string): Promise<YandexWarehouseStockRow[]> {
  const { fbyCampaignId, fbsCampaignId } = await getYandexCredentials(marketplaceId);
  const [fboRows, fbsRows, warehouseNames] = await Promise.all([
    fetchCampaignStocksByWarehouse(marketplaceId, fbyCampaignId),
    fetchCampaignStocksByWarehouse(marketplaceId, fbsCampaignId),
    fetchYandexWarehouseNames(marketplaceId),
  ]);

  const byKey = new Map<string, YandexWarehouseStockRow>();
  for (const r of [...fboRows, ...fbsRows]) {
    const warehouseName = warehouseNames.get(r.warehouseId) ?? `Склад #${r.warehouseId}`;
    const key = `${r.offerId}|${warehouseName}`;
    const existing = byKey.get(key);
    if (existing) existing.qtyAvailable += r.qty;
    else byKey.set(key, { vendorCode: r.offerId, warehouseName, qtyAvailable: r.qty });
  }
  return [...byKey.values()];
}

type OrdersResponse = {
  orders: {
    items: { offerId: string; count: number; partnerWarehouseId?: string }[];
  }[];
  paging?: { nextPageToken?: string };
};

function formatYandexDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

/**
 * Заказы кампании напрямую (не асинхронный отчёт shows-sales — тот
 * ограничен 1 запросом в 10 минут на businessId, для регулярного синка
 * непригоден). У каждой позиции заказа есть partnerWarehouseId — реальный
 * склад отгрузки, из которого и строится продажи по региону. Только
 * status=DELIVERED — довезённые, не отменённые. Диапазон дат — не больше
 * 30 дней за один запрос (ограничение самого Yandex).
 */
async function fetchCampaignOrdersByWarehouse(
  marketplaceId: string,
  campaignId: string,
  dateFrom: Date,
  dateTo: Date
): Promise<{ offerId: string; warehouseId: string; qty: number }[]> {
  const rows: { offerId: string; warehouseId: string; qty: number }[] = [];
  let pageToken: string | undefined;

  for (;;) {
    const params = new URLSearchParams({
      limit: "200",
      status: "DELIVERED",
      fromDate: formatYandexDate(dateFrom),
      toDate: formatYandexDate(dateTo),
    });
    if (pageToken) params.set("page_token", pageToken);

    const res = await fetch(`${YANDEX_MARKET_BASE_URL}/campaigns/${campaignId}/orders?${params}`, {
      headers: await yandexHeaders(marketplaceId),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Yandex Market API /orders вернул ${res.status}: ${text.slice(0, 300)}`);
    }
    const data: OrdersResponse = await res.json();

    for (const order of data.orders) {
      for (const item of order.items) {
        if (!item.partnerWarehouseId) continue;
        rows.push({ offerId: item.offerId, warehouseId: item.partnerWarehouseId, qty: item.count });
      }
    }

    const next = data.paging?.nextPageToken;
    if (!next) break;
    pageToken = next;
  }

  return rows;
}

export type YandexWarehouseSalesRow = { vendorCode: string; warehouseName: string; soldQty: number };

/**
 * Продажи по каждому физическому складу отдельно (FBY + FBS вместе) за
 * последние windowDays дней — для расчёта среднесуточных продаж по региону
 * в распределении поставок. windowDays должно быть ≤ 30 (лимит Yandex на
 * диапазон одного запроса) — если синку нужно окно шире, это отдельная
 * доработка (несколько последовательных запросов), сейчас не требуется.
 */
export async function fetchYandexMarketSalesByWarehouse(marketplaceId: string, windowDays: number): Promise<YandexWarehouseSalesRow[]> {
  const dateTo = new Date();
  const dateFrom = new Date();
  dateFrom.setDate(dateFrom.getDate() - windowDays);

  const { fbyCampaignId, fbsCampaignId } = await getYandexCredentials(marketplaceId);
  const [fboItems, fbsItems, warehouseNames] = await Promise.all([
    fetchCampaignOrdersByWarehouse(marketplaceId, fbyCampaignId, dateFrom, dateTo),
    fetchCampaignOrdersByWarehouse(marketplaceId, fbsCampaignId, dateFrom, dateTo),
    fetchYandexWarehouseNames(marketplaceId),
  ]);

  const byKey = new Map<string, YandexWarehouseSalesRow>();
  for (const item of [...fboItems, ...fbsItems]) {
    const warehouseName = warehouseNames.get(Number(item.warehouseId)) ?? `Склад #${item.warehouseId}`;
    const key = `${item.offerId}|${warehouseName}`;
    const existing = byKey.get(key);
    if (existing) existing.soldQty += item.qty;
    else byKey.set(key, { vendorCode: item.offerId, warehouseName, soldQty: item.qty });
  }
  return [...byKey.values()];
}

export type YandexMarketMonthlySale = { offerId: string; year: number; month: number; qty: number };

type ReportGenerateResponse = {
  status: string;
  result?: { reportId: string; estimatedGenerationTime: number };
  errors?: { code: string; message: string }[];
};

type ReportInfoResponse = {
  status: string;
  result?: { status: string; file?: string; subStatus?: string };
  errors?: { code: string; message: string }[];
};

type SalesFunnelRow = {
  month: string; // "MM-YYYY"
  year: number;
  offerId: string;
  orderItemsDeliveredCount: number | string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Общий паттерн для всех асинхронных отчётов Yandex Market: генерация →
 * поллинг статуса (/reports/info/{id}) → скачивание готового файла. У
 * каждого вида отчёта (path) свой независимый рейт-лимит (см. вызывающий
 * код), сюда это не относится — просто механика запрос/ожидание/скачивание,
 * возвращает сырой Buffer (zip с JSON или xlsx — зависит от path/format).
 */
async function generateAndDownloadReport(
  marketplaceId: string,
  path: string,
  body: Record<string, unknown>,
  format?: "JSON"
): Promise<Buffer> {
  const url = `${YANDEX_MARKET_BASE_URL}/v2/reports/${path}/generate${format ? `?format=${format}` : ""}`;
  const genRes = await fetch(url, {
    method: "POST",
    headers: await yandexHeaders(marketplaceId),
    body: JSON.stringify(body),
  });
  const genData: ReportGenerateResponse = await genRes.json();
  if (!genRes.ok || genData.status !== "OK" || !genData.result) {
    throw new Error(
      `Не удалось запустить отчёт ${path}: ${genData.errors?.[0]?.message ?? genRes.status}`
    );
  }
  const reportId = genData.result.reportId;

  let fileUrl: string | undefined;
  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(attempt === 0 ? Math.min(genData.result.estimatedGenerationTime, 15000) : 5000);
    const infoRes = await fetch(`${YANDEX_MARKET_BASE_URL}/v2/reports/info/${reportId}`, {
      headers: await yandexHeaders(marketplaceId),
    });
    const infoData: ReportInfoResponse = await infoRes.json();
    if (!infoRes.ok || infoData.status !== "OK" || !infoData.result) {
      throw new Error(`Не удалось получить статус отчёта ${path}: ${infoData.errors?.[0]?.message ?? infoRes.status}`);
    }
    if (infoData.result.status === "DONE") {
      fileUrl = infoData.result.file;
      break;
    }
    if (infoData.result.status === "FAILED") {
      throw new Error(`Генерация отчёта ${path} завершилась с ошибкой: ${infoData.result.subStatus ?? "неизвестно"}`);
    }
  }
  if (!fileUrl) {
    throw new Error(`Отчёт ${path} не сгенерировался за отведённое время`);
  }

  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) {
    throw new Error(`Не удалось скачать отчёт ${path}: ${fileRes.status}`);
  }
  return Buffer.from(await fileRes.arrayBuffer());
}

/**
 * Тянет отчёт «Аналитика продаж» (по всем кампаниям бизнеса сразу) и
 * агрегирует "доставлено" штук по месяцам на офер. Без подписки Маркет не
 * отдаёт данные старше 90 дней — берём максимум доступного окна. Жёстко
 * ограничен 1 запросом генерации в 10 минут на бизнес — вызывать нечасто
 * (раз в сутки в фоновом синке).
 */
export async function fetchYandexMarketMonthlySales(marketplaceId: string): Promise<YandexMarketMonthlySale[]> {
  const dateTo = new Date();
  dateTo.setDate(dateTo.getDate() - 1);
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - 89); // 90 дней — лимит без подписки

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const { businessId } = await getYandexCredentials(marketplaceId);

  const buffer = await generateAndDownloadReport(
    marketplaceId,
    "shows-sales",
    { businessId: Number(businessId), dateFrom: fmt(dateFrom), dateTo: fmt(dateTo), grouping: "OFFERS" },
    "JSON"
  );

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const jsonFile = Object.values(zip.files).find((f) => f.name.endsWith(".json"));
  if (!jsonFile) {
    throw new Error("В отчёте не нашёлся JSON-файл");
  }
  const jsonText = await jsonFile.async("string");
  const data: { rows: SalesFunnelRow[] } = JSON.parse(jsonText);

  const qtyByBucket = new Map<string, number>(); // key = offerId|year|month
  for (const row of data.rows) {
    const delivered = Number(row.orderItemsDeliveredCount ?? 0);
    if (!delivered) continue;
    const [monthStr] = row.month.split("-");
    const month = Number(monthStr);
    const key = `${row.offerId}|${row.year}|${month}`;
    qtyByBucket.set(key, (qtyByBucket.get(key) ?? 0) + delivered);
  }

  return [...qtyByBucket].map(([key, qty]) => {
    const [offerId, yearStr, monthStr] = key.split("|");
    return { offerId, year: Number(yearStr), month: Number(monthStr), qty };
  });
}

export type YandexRealizationRow = { orderId: string; yourSku: string; qty: number; revenueRub: number };
export type YandexRealizationReport = {
  delivered: YandexRealizationRow[];
  unredeemed: YandexRealizationRow[];
  returned: YandexRealizationRow[];
};

type RealizationJsonRow = {
  orderId: number;
  yourSku: string;
  deliveredCount?: number;
  unredeemedCount?: number;
  returnedCount?: number;
  deliveredPriceSumWithVatAndDiscounts?: number;
};

/**
 * Отчёт «Реализация товаров» одной кампании за календарный месяц — выручка
 * (delivered), невыкуп (unredeemed) и возвраты (returned) по SKU. Общий
 * рейт-лимит на весь businessId (не на кампанию!) — 1 запрос в 2 минуты на
 * этот вид отчёта, см. fetchYandexGoodsRealizationBothCampaigns ниже, где
 * это учтено явной паузой между FBY и FBS.
 */
export async function fetchYandexGoodsRealization(
  marketplaceId: string,
  campaignId: string,
  month: number,
  year: number
): Promise<YandexRealizationReport> {
  const buffer = await generateAndDownloadReport(marketplaceId, "goods-realization", { campaignId: Number(campaignId), month, year }, "JSON");

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  async function readRows(fileName: string): Promise<RealizationJsonRow[]> {
    const file = Object.values(zip.files).find((f) => f.name.endsWith(fileName));
    if (!file) return [];
    const text = await file.async("string");
    const data: { rows: RealizationJsonRow[] } = JSON.parse(text);
    return data.rows;
  }

  const [deliveredRows, unredeemedRows, returnedRows] = await Promise.all([
    readRows("delivered.json"),
    readRows("unredeemed.json"),
    readRows("returned.json"),
  ]);

  const toRow = (r: RealizationJsonRow, qtyField: keyof RealizationJsonRow): YandexRealizationRow => ({
    orderId: String(r.orderId),
    yourSku: r.yourSku,
    qty: Number(r[qtyField] ?? 0),
    revenueRub: Number(r.deliveredPriceSumWithVatAndDiscounts ?? 0),
  });

  return {
    delivered: deliveredRows.map((r) => toRow(r, "deliveredCount")),
    unredeemed: unredeemedRows.map((r) => toRow(r, "unredeemedCount")),
    returned: returnedRows.map((r) => toRow(r, "returnedCount")),
  };
}

/**
 * Обе кампании (FBY + FBS) сразу, с явной паузой между вызовами — лимит
 * «1 запрос в 2 минуты» общий на businessId, а не отдельный на каждую
 * кампанию (проверено эмпирически: второй запрос сразу после первого для
 * другого campaignId вернул 420). 130с — тот же двухминутный лимит плюс
 * запас на то, что первый вызов сам уже съел десяток секунд на поллинг.
 */
export async function fetchYandexGoodsRealizationBothCampaigns(
  marketplaceId: string,
  month: number,
  year: number
): Promise<YandexRealizationReport> {
  const { fbyCampaignId, fbsCampaignId } = await getYandexCredentials(marketplaceId);
  const fby = await fetchYandexGoodsRealization(marketplaceId, fbyCampaignId, month, year);
  await sleep(130_000);
  const fbs = await fetchYandexGoodsRealization(marketplaceId, fbsCampaignId, month, year);
  return {
    delivered: [...fby.delivered, ...fbs.delivered],
    unredeemed: [...fby.unredeemed, ...fbs.unredeemed],
    returned: [...fby.returned, ...fbs.returned],
  };
}

export type YandexServiceCostRow = {
  sheetName: string; // вид услуги (лист отчёта) — категоризация в вызывающем коде
  yourSku: string | null; // null — лист не даёт разбивку по товару (напр. подписка, поставка через транзитный склад)
  orderId: string | null; // для попытки привязать к товару через заказ, когда SKU в листе нет
  costRub: number;
};

/**
 * Отчёт «Стоимость услуг маркетплейса» (комиссия, логистика, хранение,
 * реклама, эквайринг и т.д.) за период — единственный источник расходов
 * Яндекса, аналог финансового отчёта WB / транзакций Ozon. В отличие от
 * них — не единая таблица, а xlsx с ~17 листами (один на вид услуги), у
 * большинства из которых есть колонка "Ваш SKU". Разбор — универсальный, не
 * захардкоженный под конкретные номера колонок (они плывут между листами):
 * колонка стоимости — САМАЯ ПРАВАЯ колонка в шапке, где текст содержит
 * "Стоимость" (у части листов после неё идёт ещё "Тип записи"/similar, но
 * "Стоимость..." всегда правее промежуточных "Стоимость... до вычета" и
 * "Стоимость... без скидок", поэтому берём последнее совпадение, а не
 * первое). Строки без заполненной первой ячейки (ID бизнес-аккаунта) —
 * служебные подзаголовки (напр. "Тариф, %" второй строкой шапки), а не
 * данные, пропускаем.
 */
export async function fetchYandexServicesReport(
  marketplaceId: string,
  businessId: string,
  dateFrom: string,
  dateTo: string
): Promise<YandexServiceCostRow[]> {
  const buffer = await generateAndDownloadReport(marketplaceId, "united-marketplace-services", {
    businessId: Number(businessId),
    dateFrom,
    dateTo,
  });

  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as any);

  const rows: YandexServiceCostRow[] = [];

  for (const ws of workbook.worksheets) {
    let headerRowNumber = -1;
    let headers: string[] = [];
    for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
      // Array.from densifies — row.values из ExcelJS разрежен (индекс 0 —
      // дыра), а .map() на разреженном массиве дыры пропускает и оставляет
      // их дырами же, из-за чего headers[i] ниже мог быть undefined.
      const values = Array.from(ws.getRow(r).values as any[]).map((v) =>
        typeof v === "string" ? v.trim() : ""
      );
      if (values.some((v) => v.includes("Стоимость"))) {
        headerRowNumber = r;
        headers = values;
        break;
      }
    }
    if (headerRowNumber === -1) continue; // лист без табличных данных (напр. "Сводка")

    const skuColIdx = headers.findIndex((h) => h === "Ваш SKU");
    const orderColIdx = headers.findIndex((h) => h === "Номер заказа или отгрузки");
    let costColIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      if ((headers[i] ?? "").includes("Стоимость")) costColIdx = i; // последнее совпадение — самое правое
    }
    if (costColIdx === -1) continue;

    for (let r = headerRowNumber + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const firstCell = row.getCell(1).value;
      if (firstCell === null || firstCell === undefined || firstCell === "") continue; // подзаголовок/пустая строка

      const costCell = row.getCell(costColIdx).value;
      const costRub = typeof costCell === "number" ? costCell : Number(costCell ?? 0);
      if (!costRub) continue;

      const skuCell = skuColIdx >= 0 ? row.getCell(skuColIdx).value : null;
      const yourSku = typeof skuCell === "string" && skuCell.trim() ? skuCell.trim() : null;

      const orderCell = orderColIdx >= 0 ? row.getCell(orderColIdx).value : null;
      const orderId =
        typeof orderCell === "number"
          ? String(Math.round(orderCell))
          : typeof orderCell === "string" && orderCell.trim()
            ? orderCell.trim()
            : null;

      rows.push({ sheetName: ws.name, yourSku, orderId, costRub });
    }
  }

  return rows;
}
