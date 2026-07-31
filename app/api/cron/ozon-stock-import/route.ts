import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenantContext";
import { runOzonStockImportSync } from "@/lib/dailySync";

// См. app/api/cron/ozon-unit-economics/route.ts — один из 4 отдельных
// ночных cron-вызовов для Ozon, разбитых из-за лимита времени Vercel Hobby.
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
      results[company.id] = await runWithTenant({ companyId: company.id, userId }, runOzonStockImportSync);
    } catch (err: any) {
      results[company.id] = { error: err?.message ?? "неизвестная ошибка" };
    }
  }

  return NextResponse.json({ companiesProcessed: companies.length, results });
}
