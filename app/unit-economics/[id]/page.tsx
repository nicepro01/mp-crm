import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import UnitEconomicsForm from "../UnitEconomicsForm";

export const dynamic = "force-dynamic";

export default async function EditUnitEconomicsPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => EditUnitEconomicsPageContent(params));
}

async function EditUnitEconomicsPageContent(params: { id: string }) {
  const [record, products, marketplaces] = await Promise.all([
    prisma.unitEconomics.findUnique({ where: { id: params.id } }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: { id: true, sku: true, name: true },
    }),
    prisma.marketplace.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  if (!record) notFound();

  return (
    <div>
      <h1>Редактирование расчёта</h1>
      <UnitEconomicsForm
        products={products}
        marketplaces={marketplaces}
        initial={{
          id: record.id,
          productId: record.productId,
          marketplaceId: record.marketplaceId ?? "",
          periodMonth: record.periodMonth.toISOString().slice(0, 7),
          cogsRub: record.cogsRub.toString(),
          inboundLogisticsRub: record.inboundLogisticsRub.toString(),
          mpCommissionRub: record.mpCommissionRub.toString(),
          mpLogisticsRub: record.mpLogisticsRub.toString(),
          storageRub: record.storageRub.toString(),
          adsRub: record.adsRub.toString(),
          taxRub: record.taxRub.toString(),
          laborAllocRub: record.laborAllocRub.toString(),
          sellPriceRub: record.sellPriceRub.toString(),
        }}
      />
    </div>
  );
}
