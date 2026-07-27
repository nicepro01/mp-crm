import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import ClusterImbalanceSection from "../ClusterImbalanceSection";

export const dynamic = "force-dynamic";

export default async function ClusterAnalyticsPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => ClusterAnalyticsPageContent());
}

async function ClusterAnalyticsPageContent() {
  const rows = await prisma.productClusterAnalytics.findMany({
    where: { marketplace: { code: "OZON" } },
    include: { product: { select: { sku: true, name: true, photoUrl: true } } },
    orderBy: { syncedAt: "desc" },
  });

  return (
    <div>
      <h1>Аналитика по регионам (кластерам)</h1>
      <p className="muted">
        То же самое доступно во вкладке «По регионам» на{" "}
        <a href="/analytics">странице «Аналитика»</a>.
      </p>
      <ClusterImbalanceSection
        rows={rows.map((r) => ({
          id: r.id,
          productId: r.productId,
          clusterName: r.clusterName,
          qtyAvailable: r.qtyAvailable,
          avgDailySalesQty: Number(r.avgDailySalesQty),
          daysOfStockLeft: r.daysOfStockLeft,
          liquidityStatus: r.liquidityStatus,
          product: r.product,
        }))}
      />
    </div>
  );
}
