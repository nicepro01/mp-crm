import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import ReturnsSyncForm from "./ReturnsSyncForm";
import ReturnsTable, { ReturnClaimRow } from "./ReturnsTable";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const session = await requireTenantSession();
  return runWithTenant(session, () => ReturnsPageContent());
}

async function ReturnsPageContent() {
  const claims = await prisma.returnClaim.findMany({
    include: { product: { select: { sku: true, name: true } } },
    orderBy: { claimDate: "desc" },
  });

  const rows: ReturnClaimRow[] = claims.map((c) => ({
    id: c.id,
    sku: c.product?.sku ?? null,
    name: c.product?.name ?? c.productName ?? "—",
    status: c.status,
    reasonText: c.reasonText,
    priceRub: c.priceRub !== null ? Number(c.priceRub) : null,
    claimDate: c.claimDate.toISOString(),
    orderDate: c.orderDate ? c.orderDate.toISOString() : null,
    photos: (c.photos as string[] | null) ?? [],
  }));

  const newCount = rows.filter((r) => r.status === 0).length;

  return (
    <div>
      <div className="toolbar">
        <h1>Возвраты</h1>
      </div>

      <p className="muted">
        Заявки покупателей на возврат с WB (с причиной, фото и статусом) —
        подтягиваются напрямую из личного кабинета, без ручной загрузки файлов.
        {newCount > 0 && (
          <>
            {" "}
            Новых заявок, которые ждут решения: <strong>{newCount}</strong>.
          </>
        )}
      </p>
      <ReturnsSyncForm />

      {rows.length === 0 ? (
        <p className="muted">
          Пока нет ни одной заявки — нажмите «Обновить из WB API», чтобы
          загрузить текущие данные.
        </p>
      ) : (
        <ReturnsTable rows={rows} />
      )}
    </div>
  );
}
