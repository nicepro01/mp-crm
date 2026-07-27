import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import StockImportForm from "./StockImportForm";
import OzonImportForm from "./OzonImportForm";
import OzonAnalyticsImportForm from "./OzonAnalyticsImportForm";
import OzonApiSyncForm from "./OzonApiSyncForm";
import WbImportForm from "./WbImportForm";
import WbAnalyticsImportForm from "./WbAnalyticsImportForm";
import WbApiSyncForm from "./WbApiSyncForm";
import SeasonalitySyncForm from "./SeasonalitySyncForm";
import YandexBackfillForm from "./YandexBackfillForm";
import YandexImportForm from "./YandexImportForm";
import YandexAnalyticsImportForm from "./YandexAnalyticsImportForm";
import YandexApiSyncForm from "./YandexApiSyncForm";

export const dynamic = "force-dynamic";

export default async function StockImportPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => StockImportPageContent());
}

async function StockImportPageContent() {
  const marketplaces = await prisma.marketplace.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div>
      <h1>Импорт остатков</h1>

      <h2 style={{ fontSize: 16 }}>Ozon — синхронизация по API</h2>
      <p className="muted">
        Тянет остатки на складах FBO напрямую из Ozon (Seller API), без ручной
        загрузки файла. Сопоставление — по SKU Ozon, как и в файлах ниже.
      </p>
      <OzonApiSyncForm />

      <h2 style={{ fontSize: 16 }}>Ozon — родной файл, без подготовки</h2>
      <p className="muted">
        Загрузите отчёт «Остатки» или «Оборачиваемость» прямо из личного
        кабинета Ozon как есть, в .xlsx — формат распознаётся автоматически.
        Товары сопоставляются по SKU Ozon (через листинг) или вручную на
        странице «Сопоставление», если листинга ещё нет. Штрихкодов в этих
        отчётах Ozon не даёт, поэтому сопоставление по штрихкоду для Ozon не
        применяется.
      </p>
      <OzonImportForm />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Ozon — аналитика (скорость продаж, дефицит, неликвид)</h2>
      <p className="muted">
        Загрузите тот же отчёт «Оборачиваемость» (тот же файл, что и выше) —
        отдельно разберём лист «Товары» и сохраним по каждому SKU скорость
        продаж, дни до конца остатка и статус ликвидности. Смотреть их можно
        на странице «Аналитика».
      </p>
      <OzonAnalyticsImportForm />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>WB — синхронизация по API</h2>
      <p className="muted">
        Тянет остатки и продажи за 28 дней напрямую из WB (раздел «Статистика»
        API), без ручной загрузки файлов. Сопоставление — по «Артикулу
        продавца», как и в файлах ниже, поэтому уже привязанные товары
        обновятся автоматически.
      </p>
      <WbApiSyncForm />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>WB — сезонность (для планирования заказа)</h2>
      <SeasonalitySyncForm
        endpoint="/api/seasonality/sync-wb"
        label="Обновить историю продаж WB"
        description={
          <>
            <strong>Сезонность по истории продаж WB</strong> — подтягивает всю
            доступную историю продаж (WB отдаёт вглубь примерно 6-7 месяцев за
            раз) и копит помесячную статистику по товару. Используется в
            Планировщике поставок и Аналитике вместо ручного коэффициента
            сезонности — там, где по товару уже накопилось достаточно данных.
          </>
        }
      />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Ozon — сезонность (для планирования заказа)</h2>
      <SeasonalitySyncForm
        endpoint="/api/seasonality/sync-ozon"
        label="Обновить историю продаж Ozon"
        description={
          <>
            <strong>Сезонность по истории продаж Ozon</strong> — тянет
            помесячную статистику заказов сразу за год (Ozon Analytics API
            отдаёт готовую агрегацию по месяцам, в отличие от WB).
          </>
        }
      />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Яндекс.Маркет — сезонность (для планирования заказа)</h2>
      <SeasonalitySyncForm
        endpoint="/api/seasonality/sync-yandex"
        label="Обновить историю продаж Яндекс.Маркета"
        description={
          <>
            <strong>Сезонность по истории продаж Яндекс.Маркета</strong> —
            отчёт «Аналитика продаж» по всем кампаниям сразу, окно максимум 90
            дней (без подписки Маркет не отдаёт данные глубже). Метод жёстко
            ограничен одним запросом раз в 10 минут — не нажимайте кнопку
            повторно сразу после запуска.
          </>
        }
      />
      <YandexBackfillForm />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>WB — родной файл, без подготовки</h2>
      <p className="muted">
        Загрузите отчёт «Остатки» из личного кабинета WB как есть, в .xlsx.
        У WB в этом отчёте нет числового ID товара — только «Артикул
        продавца», поэтому сопоставление с товарами всегда идёт вручную на
        странице «Сопоставление» (штрихкодов WB тоже не выгружает).
      </p>
      <WbImportForm />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>WB — аналитика (продажи, цена, скорость)</h2>
      <p className="muted">
        Загрузите отчёт «Оборачиваемость» WB (лист «Товары» — воронка продаж
        по карточкам). В отличие от Ozon, здесь есть реальная цена и сумма
        заказов — пригодится для юнит-экономики.
      </p>
      <WbAnalyticsImportForm />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Яндекс.Маркет — синхронизация по API</h2>
      <p className="muted">
        Тянет остатки FBO и FBS напрямую из Yandex Market API, без ручной
        загрузки файла. Сопоставление — по артикулу продавца, как и в файлах
        ниже.
      </p>
      <YandexApiSyncForm />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Яндекс.Маркет — родной файл, без подготовки</h2>
      <p className="muted">
        Загрузите отчёт «Остатки на складе» из личного кабинета ЯМ как есть,
        в .xlsx. Как и у WB, числового ID здесь нет для сопоставления по
        второму отчёту — общий ключ это «Ваш SKU», сопоставление
        несопоставленных — вручную на странице «Сопоставление».
      </p>
      <YandexImportForm />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Яндекс.Маркет — аналитика (продажи, цена)</h2>
      <p className="muted">
        Загрузите отчёт «Аналитика продаж» ЯМ. Загружайте его{" "}
        <strong>после</strong> отчёта «Остатки на складе» — иначе остаток для
        расчёта «дней до конца» ещё не будет известен. Период выгрузки — за
        месяц: точной даты в этом отчёте нет, среднесуточные продажи считаем
        исходя из 30 дней.
      </p>
      <YandexAnalyticsImportForm />

      <h2 style={{ fontSize: 16, marginTop: 32 }}>Другая площадка — CSV вручную</h2>
      <p className="muted">
        Для WB, Яндекс.Маркета или произвольной выгрузки: сохраните отчёт как
        CSV (в Excel/Google Таблицах — «Файл → Сохранить как → CSV») и
        укажите вручную, какая колонка за что отвечает.
      </p>

      {marketplaces.length === 0 ? (
        <p className="error">Сначала добавьте хотя бы одну площадку.</p>
      ) : (
        <StockImportForm marketplaces={marketplaces} />
      )}
    </div>
  );
}
