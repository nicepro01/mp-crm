import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireTenantSession } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import BatchForm from "../BatchForm";
import BatchItemsSection from "../BatchItemsSection";
import WarehouseExportButton from "../WarehouseExportButton";

export const dynamic = "force-dynamic";

export default async function EditBatchPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireTenantSession();
  return runWithTenant(session, () => EditBatchPageContent(params));
}

async function EditBatchPageContent(params: { id: string }) {
  const [batch, suppliers, products, items] = await Promise.all([
    prisma.batch.findUnique({ where: { id: params.id } }),
    prisma.supplier.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        sku: true,
        name: true,
        photoUrl: true,
        unitsPerBox: true,
        boxWeightKg: true,
        boxLengthMm: true,
        boxWidthMm: true,
        boxHeightMm: true,
      },
    }),
    prisma.batchItem.findMany({
      where: { batchId: params.id },
      include: { product: true, unitCost: true, supplier: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!batch) notFound();

  return (
    <div>
      <h1>Редактирование поставки</h1>
      <BatchForm
        initial={{
          id: batch.id,
          batchNumber: batch.batchNumber,
          orderDate: batch.orderDate.toISOString().slice(0, 10),
          shipmentDate: batch.shipmentDate
            ? batch.shipmentDate.toISOString().slice(0, 10)
            : "",
          etaDate: batch.etaDate ? batch.etaDate.toISOString().slice(0, 10) : "",
          arrivedDate: batch.arrivedDate
            ? batch.arrivedDate.toISOString().slice(0, 10)
            : "",
          logisticsStatus: batch.logisticsStatus,
          notes: batch.notes ?? "",
        }}
      />

      {suppliers.length === 0 && (
        <p className="error" style={{ marginTop: 16 }}>
          Чтобы указывать поставщика у товаров, сначала заведите хотя бы
          одного поставщика на странице «Поставщики».
        </p>
      )}

      {items.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 16, marginBottom: 0 }}>
            Раскладка для сотрудника склада — как распределить эту поставку
            по площадкам и городам/кластерам внутри каждой площадки,
            пропорционально нехватке и продажам. Товары без продаж за
            период тоже распределяются — по остатку (выравнивание), а не по
            спросу, такие строки помечены отдельно.
          </p>
          <WarehouseExportButton batchId={batch.id} />
        </>
      )}

      <BatchItemsSection
        batchId={batch.id}
        products={products.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          photoUrl: p.photoUrl,
          unitsPerBox: p.unitsPerBox,
          boxWeightKg: p.boxWeightKg.toString(),
          boxLengthMm: p.boxLengthMm,
          boxWidthMm: p.boxWidthMm,
          boxHeightMm: p.boxHeightMm,
        }))}
        items={items.map((item) => ({
          id: item.id,
          qty: item.qty,
          purchasePriceRub: item.purchasePriceRub.toString(),
          product: {
            id: item.product.id,
            sku: item.product.sku,
            name: item.product.name,
            photoUrl: item.product.photoUrl,
            unitsPerBox: item.product.unitsPerBox,
            boxWeightKg: item.product.boxWeightKg.toString(),
            boxLengthMm: item.product.boxLengthMm,
            boxWidthMm: item.product.boxWidthMm,
            boxHeightMm: item.product.boxHeightMm,
          },
          supplier: item.supplier
            ? {
                id: item.supplier.id,
                name: item.supplier.name,
              }
            : null,
          unitCost: item.unitCost
            ? {
                productCostRub: item.unitCost.productCostRub.toString(),
                logisticsCostRub: item.unitCost.logisticsCostRub.toString(),
                landedCostRub: item.unitCost.landedCostRub.toString(),
              }
            : null,
        }))}
      />
    </div>
  );
}
