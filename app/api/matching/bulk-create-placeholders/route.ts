import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";

/**
 * Массовое создание товаров-заглушек по текущим PENDING позициям
 * сопоставления: SKU и название берутся из площадки, вес/габариты — 1
 * как явная заглушка (в отчётах площадок таких данных нет). Каждая
 * позиция сразу привязывается к созданному товару. Пользователь потом
 * донастраивает реальные габариты у получившихся товаров вручную.
 * Необязательный marketplaceId в теле — ограничить только одним магазином
 * (напр. только что подключённым вторым Ozon), не трогая PENDING других
 * площадок; без него — поведение как раньше, по всем сразу.
 */
export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const marketplaceId = typeof body?.marketplaceId === "string" ? body.marketplaceId : undefined;

  const pendingItems = await prisma.mpImportItem.findMany({
    where: { status: "PENDING", ...(marketplaceId ? { marketplaceId } : {}) },
  });

  let created = 0;
  const errors: string[] = [];

  for (const item of pendingItems) {
    try {
      await prisma.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            companyId: getCurrentCompanyId(),
            sku: item.mpSku,
            name: item.name || item.mpSku,
            itemWeightG: 1,
            itemLengthMm: 1,
            itemWidthMm: 1,
            itemHeightMm: 1,
            unitsPerBox: 1,
            boxWeightKg: 1,
            boxLengthMm: 1,
            boxWidthMm: 1,
            boxHeightMm: 1,
          },
        });

        await tx.mpImportItem.update({
          where: { id: item.id },
          data: {
            status: "MATCHED",
            matchedProductId: product.id,
            matchedVia: "placeholder",
            resolvedAt: new Date(),
          },
        });

        // Листинг связывает товар с площадкой — без него товар "не виден"
        // на странице "Листинги" и в юнит-экономике по конкретной площадке.
        await tx.mpListing.upsert({
          where: {
            marketplaceId_mpSku: { marketplaceId: item.marketplaceId, mpSku: item.mpSku },
          },
          create: {
            companyId: getCurrentCompanyId(),
            productId: product.id,
            marketplaceId: item.marketplaceId,
            mpSku: item.mpSku,
            commissionPct: 0,
          },
          update: { productId: product.id },
        });
      });

      created++;
    } catch (err: any) {
      errors.push(`${item.mpSku}: ${err.message ?? "неизвестная ошибка"}`);
    }
  }

  return NextResponse.json({ created, total: pendingItems.length, errors });
}
