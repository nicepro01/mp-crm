import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import ProductForm from "../ProductForm";

export const dynamic = "force-dynamic";

type NewProductPageSearchParams = {
  sku?: string;
  barcode?: string;
  name?: string;
  returnTo?: string;
  matchItemId?: string;
};

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: NewProductPageSearchParams;
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => NewProductPageContent(searchParams));
}

async function NewProductPageContent(searchParams: NewProductPageSearchParams) {
  const hasPrefill = Boolean(searchParams.sku || searchParams.barcode || searchParams.name);

  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div>
      <h1>Новый товар</h1>
      {hasPrefill && (
        <p className="muted">
          SKU, штрихкод и название подставлены из несопоставленной позиции на
          странице «Сопоставление» — проверьте и заполните остальные поля.
          {searchParams.matchItemId &&
            " После сохранения товар автоматически привяжется к этой позиции."}
        </p>
      )}
      <ProductForm
        initial={{
          sku: searchParams.sku ?? "",
          barcode: searchParams.barcode ?? "",
          name: searchParams.name ?? "",
        }}
        returnTo={searchParams.returnTo}
        suppliers={suppliers}
        matchItemId={searchParams.matchItemId}
      />
    </div>
  );
}
