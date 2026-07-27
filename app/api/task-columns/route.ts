import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";

export async function POST(req: NextRequest) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req));
}

async function POSTContent(req: NextRequest) {
  const data = await req.json();

  if (!data.title || !String(data.title).trim()) {
    return NextResponse.json({ error: "Укажите название колонки" }, { status: 400 });
  }

  try {
    const last = await prisma.taskColumn.findFirst({ orderBy: { order: "desc" } });
    const column = await prisma.taskColumn.create({
      data: {
        companyId: getCurrentCompanyId(),
        title: String(data.title).trim(),
        order: (last?.order ?? 0) + 1024,
      },
    });
    return NextResponse.json(column, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось создать колонку" },
      { status: 400 }
    );
  }
}
