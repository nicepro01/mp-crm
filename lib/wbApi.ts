import { prisma } from "./prisma";

export type WbCredentials = { token: string };

// Токен теперь свой у каждой компании (см. app/settings/integrations) —
// хранится в Marketplace.credentials текущей компании (companyId
// подставляет автоматически расширенный Prisma-клиент, см. lib/prisma.ts),
// а не в общем на все компании process.env.
async function getCredentials(): Promise<WbCredentials> {
  const marketplace = await prisma.marketplace.findFirst({ where: { code: "WB" } });
  const credentials = marketplace?.credentials as WbCredentials | null | undefined;
  if (!credentials?.token) {
    throw new Error("Токен WB не настроен — заполните его в «Настройки → Интеграции»");
  }
  return credentials;
}

async function wbGet<T>(baseUrl: string, path: string, params: Record<string, string>): Promise<T> {
  const { token } = await getCredentials();
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WB API ${path} вернул ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function wbPost<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const { token } = await getCredentials();
  const res = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WB API ${path} вернул ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// --- Контент API: карточки товаров, нужны только чтобы перевести nmId в
// артикул продавца — новый метод остатков (см. ниже) отдаёт только nmId.
const CONTENT_URL = "https://content-api.wildberries.ru";

type WbCardsListResponse = {
  cards: {
    nmID: number;
    vendorCode: string;
    title: string;
    brand: string;
    photos?: { square: string }[];
  }[];
  cursor: { updatedAt: string; nmID: number; total: number };
};

export type WbCardInfo = { vendorCode: string; name: string | null; photoUrl: string | null };

/** Вся номенклатура продавца: nmId -> {артикул продавца, название, фото}. */
export async function fetchWbNmIdToVendorCode(): Promise<Map<number, WbCardInfo>> {
  const map = new Map<number, WbCardInfo>();
  let cursor: { updatedAt: string; nmID: number } | undefined;

  for (;;) {
    const settings: any = { cursor: { limit: 100 }, filter: { withPhoto: -1 } };
    if (cursor) settings.cursor = { ...settings.cursor, ...cursor };

    const page = await wbPost<WbCardsListResponse>(CONTENT_URL, "/content/v2/get/cards/list", {
      settings,
    });
    for (const card of page.cards) {
      map.set(card.nmID, {
        vendorCode: card.vendorCode,
        name: [card.brand, card.title].filter(Boolean).join(" — ") || null,
        photoUrl: card.photos?.[0]?.square ?? null,
      });
    }

    if (page.cards.length < 100) break;
    cursor = { updatedAt: page.cursor.updatedAt, nmID: page.cursor.nmID };
  }

  return map;
}

// --- Аналитика: новый метод остатков (заменяет отключённый
// GET /api/v1/supplier/stocks). Требует персональный/сервисный токен с
// категорией "Аналитика". Лимит — 1 запрос в 20 секунд.
const ANALYTICS_URL = "https://seller-analytics-api.wildberries.ru";

export type WbWarehouseStockEntry = {
  nmId: number;
  chrtId: number;
  warehouseName: string;
  quantity: number;
};

type WbStocksReportResponse = {
  data: { items: WbWarehouseStockEntry[] };
};

/** Текущий остаток на складах WB (FBW), по всем складам и товарам сразу. */
export async function fetchWbStocksByWarehouse(): Promise<WbWarehouseStockEntry[]> {
  const all: WbWarehouseStockEntry[] = [];
  let offset = 0;
  const limit = 1000;

  for (;;) {
    const page = await wbPost<WbStocksReportResponse>(
      ANALYTICS_URL,
      "/api/analytics/v1/stocks-report/wb-warehouses",
      { limit, offset }
    );
    all.push(...page.data.items);
    if (page.data.items.length < limit) break;
    offset += limit;
  }

  return all;
}

// --- Статистика: продажи (метод пока не помечен устаревшим, отдаёт
// артикул продавца напрямую).
const STATISTICS_URL = "https://statistics-api.wildberries.ru";

export type WbSaleEntry = {
  date: string;
  supplierArticle: string;
  nmId: number;
  barcode: string;
  saleID: string; // "S..." — продажа, "R..." — возврат
  finishedPrice: number;
};

/** Продажи и возвраты за период (используем для расчёта среднесуточных продаж). */
export async function fetchWbSales(dateFrom: string): Promise<WbSaleEntry[]> {
  return wbGet<WbSaleEntry[]>(STATISTICS_URL, "/api/v1/supplier/sales", { dateFrom });
}

// --- Отчёт о реализации (детальный): реальные выплаты, комиссия, логистика,
// хранение по каждой операции. Одна строка — одна операция (продажа,
// логистика, хранение, штраф и т.д.), поэтому у одного товара за период
// много строк с разным supplier_oper_name — считать нужно по сумме всех
// строк на nm_id, а не по одной. Пагинация — курсор rrd_id, а не offset.
export type WbFinanceRow = {
  nm_id: number;
  supplier_oper_name: string;
  quantity: number;
  // retail_price_withdisc_rub — реальная цена продажи (после скидки
  // продавца, до комиссии WB); retail_amount, вопреки названию, для этого
  // не годится — это другая, намного меньшая величина.
  retail_price_withdisc_rub: number;
  ppvz_for_pay: number;
  // ppvz_reward почти всегда 0 — реальная комиссия WB в рублях лежит в
  // ppvz_sales_commission (отрицательное число).
  ppvz_sales_commission: number;
  delivery_rub: number;
  storage_fee: number;
  penalty: number;
  deduction: number;
  acceptance: number;
  acquiring_fee: number;
  // Обратная логистика — доп. складские/транспортные доначисления сверх
  // обычной доставки (возвраты, пересортировка между складами и т.п.).
  // Идут отдельными строками с supplier_oper_name = "Возмещение издержек по
  // перевозке/по складским операциям с товаром" (ppvz_for_pay там всегда 0,
  // поэтому раньше терялись при суммировании). Часть таких строк — с
  // nm_id=0 (общескладские расходы не по конкретному товару, пропускаем).
  rebill_logistic_cost: number;
  rrd_id: number;
};

/** Детальный отчёт о реализации за период (может быть тяжёлым — недели по несколько МБ). */
export async function fetchWbFinanceReport(dateFrom: string, dateTo: string): Promise<WbFinanceRow[]> {
  const all: WbFinanceRow[] = [];
  let rrdid = 0;
  const limit = 5000;

  for (;;) {
    const page = await wbGet<WbFinanceRow[]>(STATISTICS_URL, "/api/v5/supplier/reportDetailByPeriod", {
      dateFrom,
      dateTo,
      limit: String(limit),
      rrdid: String(rrdid),
    });
    all.push(...page);
    if (page.length < limit) break;
    rrdid = page[page.length - 1].rrd_id;
  }

  return all;
}

// --- Заказы (не только выкупленные — все, включая отменённые/невыкупленные).
// Единственный способ честно посчитать % выкупа: финансовый отчёт содержит
// только уже состоявшиеся продажи/возвраты денег, а отказ от получения на
// ПВЗ там вообще не появляется ни одной строкой (деньги никогда не
// списывались) — поэтому "продажи/возвраты" всегда завышают % выкупа.
export type WbOrderRow = {
  date: string; // дата заказа
  nmId: number;
  isCancel: boolean;
  cancelDate: string; // "0001-01-01T00:00:00", если не отменялся
  warehouseName: string; // склад отгрузки заказа — реальный физический склад WB
  // Цена заказа после скидки продавца, до СПП и до комиссии WB — то же поле,
  // что и в /api/v1/supplier/sales (см. WbSaleEntry.finishedPrice), НЕ
  // перепроверено на реальном ответе именно этого эндпоинта (supplier/orders,
  // а не supplier/sales) — если сумма выйдет явно неправдоподобной, сверить
  // с реальным JSON и поправить имя поля.
  priceWithDisc: number;
};

/**
 * Заказы за период. ВАЖНО: одним запросом с dateFrom старше ~35 дней назад
 * WB обрезает ответ на середине (проверено эмпирически — валидный JSON для
 * 30 дней, битый для 45), поэтому окно ограничено константой в вызывающем
 * коде, а не пагинируется постранично (в отличие от reportDetailByPeriod).
 */
export async function fetchWbOrders(dateFrom: string): Promise<WbOrderRow[]> {
  return wbGet<WbOrderRow[]>(STATISTICS_URL, "/api/v1/supplier/orders", {
    dateFrom,
    flag: "0",
  });
}

// --- Реклама (Продвижение): расход на кампании с разбивкой по товару. Одна
// кампания (особенно автоматическая) может крутить сразу несколько
// товаров — реальный расход на конкретный SKU за день лежит в
// days[].apps[].nms[].sum, поэтому раскладка по товару не приблизительная
// (не "поровну на все товары кампании"), а именно та, что использует сам WB.
const ADVERT_URL = "https://advert-api.wildberries.ru";

// Лимит батча подтверждён эмпирически: WB отвечает 400 "number of advert
// cannot be more than 50" при большем количестве.
const AD_FULLSTATS_BATCH_SIZE = 50;

type WbAdCampaignsCountResponse = {
  adverts: { status: number; advert_list: { advertId: number }[] }[];
};

/** ID кампаний в статусах "активна" (11) и "приостановлена" (9) — архивные (7) пропускаем. */
async function fetchWbAdCampaignIds(): Promise<number[]> {
  const res = await wbGet<WbAdCampaignsCountResponse>(ADVERT_URL, "/adv/v1/promotion/count", {});
  return res.adverts
    .filter((group) => group.status === 11 || group.status === 9)
    .flatMap((group) => group.advert_list.map((a) => a.advertId));
}

type WbAdFullstatsEntry = {
  advertId: number;
  days: { apps: { nms: { nmId: number; sum: number }[] }[] }[];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Расход на рекламу за период, просуммированный по nm_id, по всем активным
 * и приостановленным кампаниям сразу. Батчами по 50 (лимит WB) с паузой
 * между запросами — рейт-лимит на этот эндпоинт строгий, проверено
 * эмпирически: срабатывает даже на ошибочных запросах примерно раз в
 * 60-90 секунд, поэтому пауза между батчами обязательна, иначе второй
 * батч почти гарантированно словит 429.
 */
export async function fetchWbAdSpendByNmId(dateFrom: string, dateTo: string): Promise<Map<number, number>> {
  const campaignIds = await fetchWbAdCampaignIds();
  const spendByNmId = new Map<number, number>();

  for (let i = 0; i < campaignIds.length; i += AD_FULLSTATS_BATCH_SIZE) {
    const batch = campaignIds.slice(i, i + AD_FULLSTATS_BATCH_SIZE);
    if (i > 0) await sleep(75_000);

    const entries = await wbGet<WbAdFullstatsEntry[]>(ADVERT_URL, "/adv/v3/fullstats", {
      ids: batch.join(","),
      beginDate: dateFrom,
      endDate: dateTo,
    });
    for (const entry of entries) {
      for (const day of entry.days) {
        for (const app of day.apps) {
          for (const nm of app.nms) {
            spendByNmId.set(nm.nmId, (spendByNmId.get(nm.nmId) ?? 0) + nm.sum);
          }
        }
      }
    }
  }

  return spendByNmId;
}

// --- Заявки на возврат от покупателей. Категория "Возвраты".
const RETURNS_URL = "https://returns-api.wildberries.ru";

export type WbClaim = {
  id: string;
  nm_id: number;
  imt_name: string;
  status: number;
  status_ex: number;
  user_comment: string | null;
  price: number | null;
  dt: string; // дата создания заявки
  order_dt: string | null;
  photos: string[] | null;
  video_paths: string[] | null;
};

type WbClaimsResponse = { claims: WbClaim[]; total: number };

/** Заявки на возврат — активные (ждут решения) или архивные (уже решённые). */
export async function fetchWbClaims(isArchive: boolean): Promise<WbClaim[]> {
  const res = await wbGet<WbClaimsResponse>(RETURNS_URL, "/api/v1/claims", {
    is_archive: String(isArchive),
  });
  return res.claims;
}
