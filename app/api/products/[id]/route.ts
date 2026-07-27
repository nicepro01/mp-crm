import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { setManualPurchasePrice } from "@/lib/productCostSync";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent(_req, { params }));
}

async function GETContent(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const product = await prisma.product.findUnique({ where: { id: params.id } });
  if (!product) {
    return NextResponse.json({ error: "Товар не найден" }, { status: 404 });
  }
  return NextResponse.json(product);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => PUTContent(req, { params }));
}

async function PUTContent(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const data = await req.json();

  try {
    const product = await prisma.product.update({
      where: { id: params.id },
      data: {
        sku: data.sku,
        name: data.name,
        category: data.category || null,
        photoUrl: data.photoUrl || null,
        barcode: data.barcode || null,
        supplierId: data.supplierId || null,
        itemWeightG: data.itemWeightG,
        itemLengthMm: data.itemLengthMm,
        itemWidthMm: data.itemWidthMm,
        itemHeightMm: data.itemHeightMm,
        unitsPerBox: data.unitsPerBox,
        boxWeightKg: data.boxWeightKg,
        boxLengthMm: data.boxLengthMm,
        boxWidthMm: data.boxWidthMm,
        boxHeightMm: data.boxHeightMm,
        isActive: data.isActive ?? true,
        seasonalDemandMultiplier: data.seasonalDemandMultiplier ?? 1,
      },
    });

    // Ручная цена — только "стартовое"/временное значение: если по товару
    // уже есть или появится поставка с ценой, она всегда перезапишет это
    // через syncProductPurchasePrice (см. lib/productCostSync.ts).
    if (data.purchasePriceRub !== undefined) {
      const parsed =
        data.purchasePriceRub === null || data.purchasePriceRub === ""
          ? null
          : Number(data.purchasePriceRub);
      await setManualPurchasePrice(params.id, parsed);
    }

    return NextResponse.json(product);
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Товар с таким SKU или штрихкодом уже существует" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить товар" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => PATCHContent(req, { params }));
}

async function PATCHContent(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const data = await req.json();

  try {
    const product = await prisma.product.update({
      where: { id: params.id },
      data: {
        ...(data.vendorCode !== undefined ? { vendorCode: data.vendorCode || null } : {}),
      },
    });
    return NextResponse.json(product);
  } catch (err: any) {
    if (err.code === "P2002") {
      return NextResponse.json(
        { error: "Такой vendorCode уже используется другим товаром" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить товар" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => DELETEContent(_req, { params }));
}

async function DELETEContent(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.product.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить товар" },
      { status: 400 }
    );
  }
}
