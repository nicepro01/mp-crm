import { prisma } from "./prisma";

const OZON_BASE_URL = "https://api-seller.ozon.ru";

export type OzonCredentials = { clientId: string; apiKey: string };

// Свои clientId/apiKey у каждой компании (см. app/settings/integrations) —
// из Marketplace.credentials текущей компании, а не общий process.env.
async function getCredentials(marketplaceId: string): Promise<OzonCredentials> {
  const marketplace = await prisma.marketplace.findUniqueOrThrow({ where: { id: marketplaceId } });
  const credentials = marketplace.credentials as OzonCredentials | null | undefined;
  if (!credentials?.clientId || !credentials?.apiKey) {
    throw new Error(`Client-Id / Api-Key Ozon не настроены для «${marketplace.name}» — заполните их в «Настройки → Интеграции»`);
  }
  return credentials;
}

async function ozonHeaders(marketplaceId: string) {
  const { clientId, apiKey } = await getCredentials(marketplaceId);
  return {
    "Client-Id": clientId,
    "Api-Key": apiKey,
    "Content-Type": "application/json",
  };
}

async function ozonPost<T>(marketplaceId: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${OZON_BASE_URL}${path}`, {
    method: "POST",
    headers: await ozonHeaders(marketplaceId),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ozon API ${path} вернул ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export type OzonStockRow = {
  vendorCode: string; // offer_id — собственный артикул продавца
  ozonSku: string; // sku — числовой ID Ozon, используем как mpSku
  qtyAvailable: number; // present - reserved, только склады FBO
};

type StocksResponse = {
  items: {
    offer_id: string;
    stocks: { type: string; present: number; reserved: number; sku: number }[];
  }[];
  cursor: string;
  total: number;
};

/**
 * Тянет остатки по всем товарам через Ozon Seller API (/v4/product/info/stocks,
 * курсорная пагинация). Берём только склады FBO (Ozon делит остаток на
 * десятки региональных складов, но present/reserved здесь уже агрегированы
 * по всем ним) — то же допущение, что и у ручного XLSX-импорта: FBS-остатки
 * Ozon не считаем.
 */
export async function fetchOzonStocks(marketplaceId: string): Promise<OzonStockRow[]> {
  const rows: OzonStockRow[] = [];
  let cursor = "";

  for (;;) {
    const page = await ozonPost<StocksResponse>(marketplaceId, "/v4/product/info/stocks", {
      filter: {},
      limit: 1000,
      cursor,
    });

    for (const item of page.items) {
      const fbo = item.stocks.find((s) => s.type === "fbo");
      if (!fbo) continue;
      rows.push({
        vendorCode: item.offer_id,
        ozonSku: String(fbo.sku),
        qtyAvailable: Math.max(0, fbo.present - fbo.reserved),
      });
    }

    if (!page.cursor || page.items.length === 0) break;
    cursor = page.cursor;
  }

  return rows;
}

export type OzonWarehouseStockRow = {
  vendorCode: string; // offer_id — приходит как item_code в этом отчёте
  warehouseName: string; // реальный физический склад, напр. "ХАБАРОВСК_2_РФЦ"
  qtyAvailable: number;
};

type StockOnWarehousesResponse = {
  result: {
    rows: { item_code: string; warehouse_name: string; free_to_sell_amount: number }[];
  };
};

/**
 * Остатки по каждому физическому складу отдельно (в отличие от
 * fetchOzonStocks, который отдаёт только сумму по типу fbo/fbs без разбивки
 * по складам) — нужно для распределения поставок по городам в
 * Планировщике. Пагинация — offset/limit, проверено эмпирически: весь
 * ассортимент умещается в один запрос (612 строк при limit 1000), но
 * оставляем цикл на случай роста каталога.
 */
export async function fetchOzonStockByWarehouse(marketplaceId: string): Promise<OzonWarehouseStockRow[]> {
  const rows: OzonWarehouseStockRow[] = [];
  let offset = 0;
  const limit = 1000;

  for (;;) {
    const page = await ozonPost<StockOnWarehousesResponse>(marketplaceId, "/v2/analytics/stock_on_warehouses", {
      limit,
      offset,
      warehouse_type: "ALL",
    });

    for (const row of page.result.rows) {
      rows.push({
        vendorCode: row.item_code,
        warehouseName: row.warehouse_name,
        qtyAvailable: row.free_to_sell_amount,
      });
    }

    if (page.result.rows.length < limit) break;
    offset += limit;
  }

  return rows;
}

export type OzonMonthlySale = { sku: string; year: number; month: number; qty: number };

type AnalyticsResponse = {
  result: {
    data: { dimensions: { id: string; name: string }[]; metrics: number[] }[];
  };
};

/**
 * Тянет помесячные заказанные штуки по каждому SKU через Ozon Seller API
 * (/v1/analytics/data, dimension month+sku) — в отличие от WB, здесь Ozon
 * сам агрегирует по месяцам, дневные события собирать не нужно. Максимум
 * один запрос — год данных (ограничение самого Ozon: "cannot get more than
 * one year"), пагинация на случай, если строк наберётся больше лимита.
 */
export async function fetchOzonMonthlySales(marketplaceId: string): Promise<OzonMonthlySale[]> {
  const dateTo = new Date();
  dateTo.setDate(dateTo.getDate() - 1); // "date_to must not be greater than current date"
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - 364);

  const rows: OzonMonthlySale[] = [];
  let offset = 0;
  const limit = 1000;

  for (;;) {
    const page = await ozonPost<AnalyticsResponse>(marketplaceId, "/v1/analytics/data", {
      date_from: dateFrom.toISOString().slice(0, 10),
      date_to: dateTo.toISOString().slice(0, 10),
      metrics: ["ordered_units"],
      dimension: ["month", "sku"],
      limit,
      offset,
    });

    const data = page.result.data;
    for (const row of data) {
      const qty = row.metrics[0] ?? 0;
      if (qty <= 0) continue;
      const [year, month] = row.dimensions[0].id.split("-").map(Number);
      const sku = row.dimensions[1].id;
      rows.push({ sku, year, month, qty });
    }

    if (data.length < limit) break;
    offset += limit;
  }

  return rows;
}

// --- Финансовые транзакции: единственный источник для реальной юнит-
// экономики Ozon — в отличие от WB, здесь revenue/комиссия/логистика/
// хранение/реклама/возврат приходят в ОДНОМ эндпоинте, по каждой операции
// с привязкой к конкретному sku (никакого отдельного рекламного API не
// нужно). Одна позиция в items — одна проданная/возвращённая единица (если
// в заказе 2 шт одного sku, sku просто повторяется в массиве дважды).
export type OzonTransactionRow = {
  operationType: string; // operation_type_name — человекочитаемая категория
  type: string; // "orders" | "returns" | "services" | "other"
  accrualsForSale: number; // выручка от продажи — только на type="orders"
  saleCommission: number; // комиссия Ozon (отрицательная) — только на type="orders"
  amount: number; // итоговый эффект операции в рублях, уже нетто (выручка минус
  // комиссия минус все сопутствующие услуги этой же операции) — надёжнее,
  // чем пытаться развернуть их из services[] по имени.
  skus: number[]; // sku повторяется в массиве столько раз, сколько единиц товара в операции
  warehouseId: number; // posting.warehouse_id — со склада какого физического склада ушёл заказ;
  // сопоставляется с fetchOzonClusters() для разбивки продаж по кластеру
  // Один физический возврат/отмена/невыкуп разбивается Ozon на 2-4 отдельные
  // транзакции type="returns" (доставка, обработка, получение — разные
  // строки услуг для ОДНОЙ и той же единицы товара, проверено эмпирически:
  // 95% посылок с возвратом дают больше одной транзакции с одним и тем же
  // posting_number). Без дедупликации по posting_number количество возвратов
  // считалось в 2-4 раза больше реального — см. использование в
  // lib/unitEconomicsSync.ts.
  postingNumber: string;
};

type TransactionListResponse = {
  result: {
    operations: {
      operation_type_name: string;
      type: string;
      accruals_for_sale: number;
      sale_commission: number;
      amount: number;
      items: { sku: number }[];
      posting: { warehouse_id: number; posting_number: string };
    }[];
    page_count: number;
  };
};

/**
 * Финансовые транзакции за период. ВАЖНО: Ozon ограничивает диапазон одним
 * месяцем ("too long period, only one month allowed") — проверено
 * эмпирически (30 дней от текущего момента иногда уже превышают лимит),
 * поэтому окно чуть меньше календарного месяца, а не ровно 30 дней.
 */
export async function fetchOzonFinanceTransactions(
  marketplaceId: string,
  dateFrom: string,
  dateTo: string
): Promise<OzonTransactionRow[]> {
  const rows: OzonTransactionRow[] = [];
  let page = 1;

  for (;;) {
    const res = await ozonPost<TransactionListResponse>(marketplaceId, "/v3/finance/transaction/list", {
      filter: { date: { from: dateFrom, to: dateTo }, transaction_type: "all" },
      page,
      page_size: 1000,
    });

    for (const op of res.result.operations) {
      rows.push({
        operationType: op.operation_type_name,
        type: op.type,
        accrualsForSale: op.accruals_for_sale,
        saleCommission: op.sale_commission,
        amount: op.amount,
        skus: op.items.map((i) => i.sku),
        warehouseId: op.posting?.warehouse_id ?? 0,
        postingNumber: op.posting?.posting_number ?? "",
      });
    }

    if (page >= res.result.page_count) break;
    page++;
  }

  return rows;
}

// Проверено на реальном аккаунте: limit строго (0, 100]; сама форма ответа —
// НЕ {result: {...}} (как у fetchOzonFinanceTransactions), поля has_next/
// cursor/postings лежат прямо в корне. Курсорная пагинация (cursor), не
// offset — хотя offset в запросе не вызывает ошибку, продолжение через
// cursor надёжнее (стандартный паттерн Ozon v3). Форма самого элемента
// postings[] (in_process_at/created_at/status) пока не перепроверена дальше
// первой страницы — если появится новое расхождение, поправить здесь же.
export type OzonPostingRow = {
  createdAt: string;
  status: string;
  // Сумма посылки — сложение price*quantity по products[] (стандартное
  // место цены у Ozon постингов, price приходит строкой). НЕ перепроверено
  // на реальном ответе (financial_data отключён — цена в products[] должна
  // быть доступна и без него, но это предположение по документации, не факт).
  priceRub: number;
  // sku повторяется в массиве столько раз, сколько единиц товара в позиции —
  // тот же формат, что и OzonTransactionRow.skus. Нужен для % выкупа по
  // товару: status ("delivered"/"cancelled") — единственный реальный,
  // не размазанный по товарам сигнал невыкупа/отмены у Ozon (в отличие от
  // /v3/finance/transaction/list, где возврат/отмена/невыкуп — одна
  // категория без разделения, см. lib/unitEconomicsSync.ts).
  skus: number[];
};

/**
 * Список отправлений (посылок) за период — отдельно FBO и FBS (у Ozon это
 * разные фиды, как FBY/FBS у Яндекса). Даёт "сырые" заказы с датой размещения
 * и статусом — то, чего нет в fetchOzonFinanceTransactions (там только уже
 * оплаченные операции). Нужно вызывать оба schema ("fbo" и "fbs") и сложить
 * результат, если нужны все продажи компании, а не одна схема доставки.
 */
export async function fetchOzonPostings(
  marketplaceId: string,
  dateFrom: string,
  dateTo: string,
  schema: "fbo" | "fbs"
): Promise<OzonPostingRow[]> {
  const rows: OzonPostingRow[] = [];
  let cursor = "";
  const limit = 100;

  for (;;) {
    // financial_data:true — включено ПОСЛЕ реальной ошибки: с false цена
    // ушла в NaN (products[].price внутри базового posting её не содержит,
    // судя по всему это gated именно за этим флагом). Ставим true — если
    // окажется, что цена лежит где-то ещё, поправить extraction ниже.
    const raw = await ozonPost<any>(marketplaceId, `/v3/posting/${schema}/list`, {
      filter: { since: dateFrom, to: dateTo },
      cursor,
      limit,
      with: { analytics_data: false, financial_data: true },
    });

    // Подтверждённая форма — postings/has_next/cursor в корне ответа; на
    // случай, если FBS (в отличие от уже проверенного FBO) всё же вернёт
    // старую форму {result: {...}}, оставляем и этот путь тоже.
    const postings:
      | {
          in_process_at?: string;
          created_at?: string;
          status: string;
          products?: { price?: string | number; quantity?: number; sku?: number }[];
          financial_data?: { products?: { price?: string | number; quantity?: number; sku?: number }[] };
        }[]
      | undefined = Array.isArray(raw?.postings)
      ? raw.postings
      : Array.isArray(raw?.result)
        ? raw.result
        : raw?.result?.postings;

    if (!postings) {
      const topKeys = Object.keys(raw ?? {}).join(", ") || "(пусто)";
      throw new Error(`Неожиданный формат ответа /v3/posting/${schema}/list — ключи верхнего уровня: [${topKeys}]`);
    }

    for (const p of postings) {
      // Пробуем financial_data.products[] (обычно именно там у Ozon цена),
      // с откатом на products[] верхнего уровня. Number.isFinite — не
      // decoративный defensive-код, а единственное, что не даёт NaN
      // долететь до Prisma (там NaN в Decimal-поле ломает upsert целиком с
      // непонятной ошибкой про "Argument company is missing" вместо
      // внятной жалобы на конкретное поле — реальный инцидент, не гипотеза).
      const items = p.financial_data?.products ?? p.products ?? [];
      const priceRub = items.reduce((sum, prod) => {
        const price = Number(prod?.price);
        const qty = Number(prod?.quantity) || 1;
        return sum + (Number.isFinite(price) ? price * qty : 0);
      }, 0);
      // sku — только из products[] верхнего уровня: financial_data.products[]
      // не содержит sku вообще (только product_id, проверено эмпирически на
      // реальном ответе), а price там нужен именно из financial_data (иначе
      // NaN, см. комментарий выше) — поэтому два разных источника для двух
      // разных полей одной и той же позиции.
      const skus: number[] = [];
      for (const prod of p.products ?? []) {
        if (!prod?.sku) continue;
        const qty = Number(prod.quantity) || 1;
        for (let i = 0; i < qty; i++) skus.push(prod.sku);
      }
      rows.push({ createdAt: p.in_process_at ?? p.created_at ?? "", status: p.status, priceRub, skus });
    }

    const hasNext: boolean = raw?.has_next ?? raw?.result?.has_next ?? false;
    const nextCursor: string = raw?.cursor ?? raw?.result?.cursor ?? "";
    if (!hasNext || !nextCursor) break;
    cursor = nextCursor;
  }

  return rows;
}

export type OzonClusterWarehouse = { warehouseId: number; warehouseName: string; clusterName: string };

type ClusterListResponse = {
  clusters: {
    name: string;
    logistic_clusters: { warehouses: { warehouse_id: number; name: string }[] }[];
  }[];
};

/**
 * Справочник склад -> кластер (кластер — то, во что Ozon сам группирует
 * склады для планирования поставок; продавец фактически везёт партию в
 * кластер, а не в конкретный физический склад). Нужен, чтобы: 1) свести
 * остатки по отдельным складам (fetchOzonStockByWarehouse) в кластеры,
 * 2) сопоставить posting.warehouse_id из финансовых транзакций с
 * кластером — так у Ozon появляются продажи по региону, а не только остаток.
 */
export async function fetchOzonClusters(marketplaceId: string): Promise<OzonClusterWarehouse[]> {
  const res = await ozonPost<ClusterListResponse>(marketplaceId, "/v1/cluster/list", {
    cluster_type: "CLUSTER_TYPE_OZON",
  });
  const rows: OzonClusterWarehouse[] = [];
  for (const cluster of res.clusters) {
    for (const lc of cluster.logistic_clusters) {
      for (const wh of lc.warehouses) {
        rows.push({ warehouseId: wh.warehouse_id, warehouseName: wh.name, clusterName: cluster.name });
      }
    }
  }
  return rows;
}

export type OzonProductAttributes = {
  offerId: string;
  ozonSku: string | null;
  name: string | null;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  photoUrl: string | null;
};

type AttributesResponse = {
  result: {
    offer_id: string;
    sku?: number;
    name?: string;
    weight?: number;
    weight_unit?: string;
    height?: number;
    width?: number;
    depth?: number;
    dimension_unit?: string;
    primary_image?: string;
    images?: string[];
  }[];
  last_id?: string;
  total?: number;
};

/**
 * Полный каталог товаров продавца (не только те, у кого есть остаток на
 * FBO — в отличие от fetchOzonStocks) вместе с реальными вес/габаритами
 * упаковки и фото от самой площадки — единственный источник вес/габаритов
 * у Ozon, /v3/product/info/list их не отдаёт (там только расчётный
 * volume_weight). Курсорная пагинация через last_id, проверено вживую:
 * лимит 100 отдаёт весь каталог за 1-2 страницы даже на 150+ товаров.
 */
export async function fetchOzonProductAttributes(marketplaceId: string): Promise<OzonProductAttributes[]> {
  const rows: OzonProductAttributes[] = [];
  let lastId = "";
  const limit = 100;

  for (;;) {
    const page = await ozonPost<AttributesResponse>(marketplaceId, "/v4/product/info/attributes", {
      filter: {},
      limit,
      last_id: lastId,
    });

    for (const p of page.result) {
      // Единицы почти всегда "g"/"mm" — но на всякий случай не додумываем
      // конвертацию для других единиц (проще пропустить значение, чем
      // тихо посчитать неверно), см. weight_unit/dimension_unit.
      const weightG = p.weight_unit === "g" || !p.weight_unit ? p.weight ?? null : null;
      const isMm = p.dimension_unit === "mm" || !p.dimension_unit;
      rows.push({
        offerId: p.offer_id,
        ozonSku: p.sku ? String(p.sku) : null,
        name: p.name || null,
        weightG: weightG ?? null,
        lengthMm: isMm ? p.depth ?? null : null,
        widthMm: isMm ? p.width ?? null : null,
        heightMm: isMm ? p.height ?? null : null,
        photoUrl: p.primary_image || p.images?.[0] || null,
      });
    }

    if (!page.last_id || page.result.length < limit) break;
    lastId = page.last_id;
  }

  return rows;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type OzonCardRating = {
  sku: number;
  rating: number;
  // Невыполненные условия рейтинга (что поднять) — только не выполненные,
  // чтобы сразу видеть "чего не хватает", не разбирая все условия подряд.
  unfulfilledConditions: { description: string; cost: number }[];
};

type RatingBySkuResponse = {
  products: {
    sku: number;
    rating: number;
    groups: { conditions: { description: string; fulfilled: boolean; cost: number }[] }[];
  }[];
};

// Контент-рейтинг (заполненность карточки: фото/текст/атрибуты, 0-100) —
// доступен без ограничений подписки (в отличие от отзывов, см.
// lib/ozonCardHealthSync.ts). Лимит площадки — 100 sku за запрос (проверено
// эмпирически: 151 сразу дал "too many skus: count=151, limit=100").
export async function fetchOzonCardRatings(marketplaceId: string, skus: number[]): Promise<OzonCardRating[]> {
  const results: OzonCardRating[] = [];
  for (const batch of chunk(skus, 100)) {
    const data = await ozonPost<RatingBySkuResponse>(marketplaceId, "/v1/product/rating-by-sku", {
      skus: batch.map(String),
    });
    for (const p of data.products) {
      const unfulfilledConditions: { description: string; cost: number }[] = [];
      for (const g of p.groups ?? []) {
        for (const c of g.conditions ?? []) {
          if (!c.fulfilled) unfulfilledConditions.push({ description: c.description, cost: c.cost });
        }
      }
      results.push({ sku: p.sku, rating: p.rating, unfulfilledConditions });
    }
  }
  return results;
}

export type OzonPriceIndex = {
  sku: number;
  // Цвет индикатора цены Ozon как есть: SUPER/GREEN/YELLOW/RED — от лучшей
  // к худшей цене относительно рынка, WITHOUT_INDEX — площадка не считала.
  colorIndex: string;
  priceIndexValue: number | null; // наша цена / минимальная цена на рынке
  competitorMinPriceRub: number | null; // минимальная цена на этот товар вне Ozon
};

type ProductInfoListResponse = {
  items: {
    sku: number;
    price_indexes?: {
      color_index?: string;
      external_index_data?: { minimal_price?: string; price_index_value?: number };
    };
  }[];
};

// Индекс цены относительно рынка — реальные данные о конкурентах прямо из
// Seller API, без парсинга чужих карточек. 151 sku влезли в один запрос при
// проверке, но батчим на случай магазинов с более широким каталогом.
export async function fetchOzonPriceIndexes(marketplaceId: string, skus: number[]): Promise<OzonPriceIndex[]> {
  const results: OzonPriceIndex[] = [];
  for (const batch of chunk(skus, 500)) {
    const data = await ozonPost<ProductInfoListResponse>(marketplaceId, "/v3/product/info/list", { sku: batch });
    for (const item of data.items) {
      const pi = item.price_indexes;
      const minimalPrice = pi?.external_index_data?.minimal_price;
      // price_index_value приходит 0 и когда индекса реально нет (minimal_price
      // пустой) — без цены конкурента 0 не значащее число, а "нет данных".
      const hasExternalIndex = !!minimalPrice;
      results.push({
        sku: item.sku,
        colorIndex: pi?.color_index || "COLOR_INDEX_WITHOUT_INDEX",
        priceIndexValue: hasExternalIndex ? pi?.external_index_data?.price_index_value ?? null : null,
        competitorMinPriceRub: hasExternalIndex ? Number(minimalPrice) : null,
      });
    }
  }
  return results;
}
