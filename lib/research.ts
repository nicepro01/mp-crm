import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentCompanyId } from "@/lib/tenantContext";
import {
  DEFAULT_COST_MODEL,
  computeUnitEconomics,
  summarizeEconomics,
  type CostModel,
} from "@/lib/researchEconomics";

// Сервис mp-research может писать в другую базу, чем та, что использует mp-crm
// в дев-режиме (у mp-crm локальный Postgres, у mp-research — Supabase).
// RESEARCH_DATABASE_URL направляет запросы этой страницы в нужную базу.
// В проде (mp-crm на той же Supabase) переменную можно не задавать.
const globalForResearch = globalThis as unknown as { researchDb?: PrismaClient };
const researchDb: PrismaClient | typeof prisma = process.env.RESEARCH_DATABASE_URL
  ? (globalForResearch.researchDb ??= new PrismaClient({ datasourceUrl: process.env.RESEARCH_DATABASE_URL }))
  : prisma;

// Данные подбора товаров живут в отдельной Postgres-схеме `research`, которую
// наполняет сервис mp-research (соседний репозиторий). Модели Prisma для неё
// в этой схеме не описаны — читаем сырым SQL. $queryRaw/$executeRaw не проходят
// через tenant-расширение (см. lib/prisma.ts), поэтому companyId подставляем
// вручную.
//
// Пока сервис mp-research гоняется с COMPANY_ID=dev, а сессия mp-crm — с
// реальным UUID компании. Переменная RESEARCH_COMPANY_ID позволяет указать,
// чьи строки показывать (по умолчанию — компания текущей сессии).
function researchCompanyId(): string {
  return process.env.RESEARCH_COMPANY_ID || getCurrentCompanyId();
}

// Supabase-пулер время от времени рвёт соединение на секунду-другую (см.
// mp-research/src/retry.ts — та же беда там). Без повтора это превращало
// всю страницу /research в пустой экран с ошибкой при каждом таком блипе.
async function withRetry<T>(fn: () => Promise<T>, tries = 3, baseMs = 800): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      const transient = msg.includes("Can't reach database server") || msg.includes("P1001") || msg.includes("P1017");
      if (!transient || i === tries) throw err;
      await new Promise((r) => setTimeout(r, baseMs * i));
    }
  }
  throw lastErr;
}

export type ResearchStatus =
  | "new"
  | "actionable"
  | "review"
  | "rejected"
  | "no_match"
  | "approved"
  | "snoozed";

export interface ResearchCandidate {
  id: string;
  status: ResearchStatus;
  categoryPath: string;
  refTitle: string | null;
  refPrice: number;
  refMonthlyUnits: number;
  refReviewCount: number;
  score: number | null;
  maxCogs: number | null;
  // косто-модель, по которой стадия 4 посчитала (для расшивки/«что если»)
  costModel: CostModel;
  // Экономика при РЕАЛЬНОЙ закупке (цена найденного поставщика, если влезает
  // в maxCogs), иначе при maxCogs. Всё на юнит, ₽.
  cogsUsed: number;
  cogsIsReal: boolean; // true — цена поставщика с Wikkeo, false — оценка maxCogs
  ozonDeductions: number; // сколько удержит Ozon (комиссия+логистика+…)
  payout: number; // к выплате на счёт
  netProfitPerUnit: number; // чистыми на юнит
  netMarginPct: number;
  netRoiPct: number;
  netProfitPerMonth: number;
  match: {
    price: number;
    priceFits: boolean;
    confidence: number;
    store: string;
    url: string;
    title: string;
  } | null;
}

interface Row {
  id: string;
  status: string;
  categoryPath: string;
  refTitle: string | null;
  refPrice: string | number;
  refMonthlyUnits: number;
  refReviewCount: number;
  score: string | number | null;
  maxCogs: string | number | null;
  profitPerMonth: string | number | null;
  marginPct: string | number | null;
  roiPct: string | number | null;
  costModel: unknown;
  match_price: string | number | null;
  match_price_fits: boolean | null;
  match_confidence: string | number | null;
  match_store: string | null;
  match_url: string | null;
  match_title: string | null;
}

const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : typeof v === "number" ? v : Number(v);

export async function getResearchCandidates(): Promise<{
  candidates: ResearchCandidate[];
  error: string | null;
}> {
  const companyId = researchCompanyId();
  try {
    const rows = await withRetry(() =>
      researchDb.$queryRawUnsafe<Row[]>(
      `
      SELECT
        c.id, c.status, c."categoryPath", c."refTitle",
        c."refPrice", c."refMonthlyUnits", c."refReviewCount", c.score,
        e."maxCogs", e."profitPerMonth", e."marginPct", e."roiPct", e."costModel",
        m.confidence      AS match_confidence,
        m."priceFits"     AS match_price_fits,
        w."wholesalePrice" AS match_price,
        w."storeSlug"     AS match_store,
        w.url             AS match_url,
        w.title           AS match_title
      FROM research."Candidate" c
      LEFT JOIN research."UnitEcon" e ON e."candidateId" = c.id
      LEFT JOIN LATERAL (
        SELECT * FROM research."SupplierMatch" sm
        WHERE sm."candidateId" = c.id
        ORDER BY sm.confidence DESC
        LIMIT 1
      ) m ON true
      LEFT JOIN research."WikkeoProduct" w ON w.id = m."wikkeoProductId"
      WHERE c."companyId" = $1
      ORDER BY c.score DESC NULLS LAST, c."createdAt" DESC
      `,
        companyId,
      ),
    );

    const candidates = rows.map((r): ResearchCandidate => {
      const refPrice = num(r.refPrice) ?? 0;
      const refMonthlyUnits = r.refMonthlyUnits ?? 0;
      const maxCogs = num(r.maxCogs);
      const costModel: CostModel =
        r.costModel && typeof r.costModel === "object"
          ? { ...DEFAULT_COST_MODEL, ...(r.costModel as Partial<CostModel>) }
          : { ...DEFAULT_COST_MODEL };

      const match =
        r.match_price === null
          ? null
          : {
              price: num(r.match_price) ?? 0,
              priceFits: Boolean(r.match_price_fits),
              confidence: num(r.match_confidence) ?? 0,
              store: r.match_store ?? "",
              url: r.match_url ?? "",
              title: r.match_title ?? "",
            };

      // COGS для строки: реальная цена поставщика, если влезает в maxCogs;
      // иначе оценка maxCogs; иначе грубо 30% от цены.
      const cogsReal = match && match.priceFits ? match.price : null;
      const cogsUsed = cogsReal ?? maxCogs ?? Math.round(refPrice * 0.3);
      const cogsIsReal = cogsReal !== null;

      const econ = computeUnitEconomics({
        sellPrice: refPrice,
        cogs: cogsUsed,
        monthlyUnits: refMonthlyUnits,
        model: costModel,
      });
      const s = summarizeEconomics(econ);

      return {
        id: r.id,
        status: r.status as ResearchStatus,
        categoryPath: r.categoryPath,
        refTitle: r.refTitle,
        refPrice,
        refMonthlyUnits,
        refReviewCount: r.refReviewCount,
        score: num(r.score),
        maxCogs,
        costModel,
        cogsUsed,
        cogsIsReal,
        ozonDeductions: s.ozonTotal,
        payout: s.payout,
        netProfitPerUnit: s.netProfit,
        netMarginPct: s.marginPct,
        netRoiPct: s.roiPct,
        netProfitPerMonth: s.profitPerMonth,
        match,
      };
    });
    return { candidates, error: null };
  } catch (err: any) {
    // Схемы `research` ещё нет / сервис mp-research не запускался.
    return { candidates: [], error: err?.message ?? "Не удалось прочитать данные подбора" };
  }
}

const ALLOWED: ResearchStatus[] = ["approved", "rejected", "review", "snoozed"];

export async function setCandidateStatus(id: string, status: string): Promise<void> {
  if (!ALLOWED.includes(status as ResearchStatus)) {
    throw new Error(`Недопустимый статус: ${status}`);
  }
  const companyId = researchCompanyId();
  await withRetry(() =>
    researchDb.$executeRawUnsafe(
    `UPDATE research."Candidate" SET status = $1 WHERE id = $2 AND "companyId" = $3`,
      status,
      id,
      companyId,
    ),
  );
}
