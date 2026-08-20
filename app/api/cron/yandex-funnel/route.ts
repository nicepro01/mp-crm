import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenantContext";
import { runYandexFunnelSync } from "@/lib/dailySync";

// См. app/api/cron/ozon-unit-economics/route.ts — тот же приём разбиения на
// отдельные ночные вызовы, теперь и для Яндекса (см. lib/dailySync.ts —
// комментарий у runMarketplaceSubSync — обязательная пауза 130с между
// FBY/FBS отчётами сама по себе съедала половину бюджета в 300с).
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const companies = await prisma.company.findMany({ include: { users: true } });
  const results: Record<string, unknown> = {};

  for (const company of companies) {
    const userId = company.users[0]?.id ?? company.id;
    try {
      results[company.id] = await runWithTenant({ companyId: company.id, userId }, runYandexFunnelSync);
    } catch (err: any) {
      results[company.id] = { error: err?.message ?? "неизвестная ошибка" };
    }
  }

  return NextResponse.json({ companiesProcessed: companies.length, results });
}
