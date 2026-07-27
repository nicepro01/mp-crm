import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";

export async function GET() {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => GETContent());
}

async function GETContent() {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(suppliers);
}

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  try {
    const supplier = await prisma.supplier.create({
      data: {
        companyId: getCurrentCompanyId(),
        name: data.name,
        contactInfo: data.contactInfo || null,
        paymentTerms: data.paymentTerms || null,
        moq: data.moq === "" || data.moq === null ? null : Number(data.moq),
        leadTimeDays:
          data.leadTimeDays === "" || data.leadTimeDays === null
            ? null
            : Number(data.leadTimeDays),
        rating:
          data.rating === "" || data.rating === null ? null : Number(data.rating),
        notes: data.notes || null,
      },
    });
    return NextResponse.json(supplier, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать поставщика" },
      { status: 400 }
    );
  }
}
