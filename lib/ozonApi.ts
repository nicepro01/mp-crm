import { prisma } from "./prisma";

const OZON_BASE_URL = "https://api-seller.ozon.ru";

export type OzonCredentials = { clientId: string; apiKey: string };

// Свои clientId/apiKey у каждой компании (см. app/settings/integrations) —
// из Marketplace.credentials текущей компании, а не общий process.env.
async function getCredentials(): Promise<OzonCredentials> {
  const marketplace = await prisma.marketplace.findFirst({ where: { code: "OZON" } });
  const credentials = marketplace?.credentials as OzonCredentials | null | undefined;
  if (!credentials?.clientId || !credentials?.apiKey) {
    throw new Error("Client-Id / Api-Key Ozon не настроены — заполните их в «Настройки → Интеграции»");
  }
  return credentials;
}

async function ozonHeaders() {
  const { clientId, apiKey } = await getCredentials();
  return {
    "Client-Id": clientId,
    "Api-Key": apiKey,
    "Content-Type": "application/json",
  };
}

async function ozonPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${OZON_BASE_URL}${path}`, {
    method: "POST",
    headers: await ozonHeaders(),
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
export async function fetchOzonStocks(): Promise<OzonStockRow[]> {
  const rows: OzonStockRow[] = [];
  let cursor = "";

  for (;;) {
    const page = await ozonPost<StocksResponse>("/v4/product/info/stocks", {
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
export async function fetchOzonStockByWarehouse(): Promise<OzonWarehouseStockRow[]> {
  const rows: OzonWarehouseStockRow[] = [];
  let offset = 0;
  const limit = 1000;

  for (;;) {
    const page = await ozonPost<StockOnWarehousesResponse>("/v2/analytics/stock_on_warehouses", {
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
export async function fetchOzonMonthlySales(): Promise<OzonMonthlySale[]> {
  const dateTo = new Date();
  dateTo.setDate(dateTo.getDate() - 1); // "date_to must not be greater than current date"
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - 364);

  const rows: OzonMonthlySale[] = [];
  let offset = 0;
  const limit = 1000;

  for (;;) {
    const page = await ozonPost<AnalyticsResponse>("/v1/analytics/data", {
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
      posting: { warehouse_id: number };
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
  dateFrom: string,
  dateTo: string
): Promise<OzonTransactionRow[]> {
  const rows: OzonTransactionRow[] = [];
  let page = 1;

  for (;;) {
    const res = await ozonPost<TransactionListResponse>("/v3/finance/transaction/list", {
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
      });
    }

    if (page >= res.result.page_count) break;
    page++;
  }

  return rows;
}

// Проверено на реальном аккаунте: limit строго (0, 100] — запрос с 1000
// падает с "Request validation error: invalid PostingFboListRequest.Limit".
// Названия полей (in_process_at, status, has_next) пока не перепроверены
// дальше этой ошибки — если появятся новые расхождения, править здесь же.
export type OzonPostingRow = {
  createdAt: string; // in_process_at — когда посылка создана/размещена
  status: string; // "delivered" | "cancelled" | "awaiting_deliver" | ... — сырой статус Ozon
};

type PostingListResponse = {
  result: {
    postings: { in_process_at: string; status: string }[];
    has_next: boolean;
  };
};

/**
 * Список отправлений (посылок) за период — отдельно FBO и FBS (у Ozon это
 * разные фиды, как FBY/FBS у Яндекса). Даёт "сырые" заказы с датой размещения
 * и статусом — то, чего нет в fetchOzonFinanceTransactions (там только уже
 * оплаченные операции). Нужно вызывать оба schema ("fbo" и "fbs") и сложить
 * результат, если нужны все продажи компании, а не одна схема доставки.
 */
export async function fetchOzonPostings(
  dateFrom: string,
  dateTo: string,
  schema: "fbo" | "fbs"
): Promise<OzonPostingRow[]> {
  const rows: OzonPostingRow[] = [];
  let offset = 0;
  const limit = 100;

  for (;;) {
    const res = await ozonPost<PostingListResponse>(`/v3/posting/${schema}/list`, {
      filter: { since: dateFrom, to: dateTo },
      offset,
      limit,
      with: { analytics_data: false, financial_data: false },
    });

    for (const p of res.result.postings) {
      rows.push({ createdAt: p.in_process_at, status: p.status });
    }

    if (!res.result.has_next) break;
    offset += limit;
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
export async function fetchOzonClusters(): Promise<OzonClusterWarehouse[]> {
  const res = await ozonPost<ClusterListResponse>("/v1/cluster/list", {
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
