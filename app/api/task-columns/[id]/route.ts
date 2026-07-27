import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";

// Частичное обновление — перетаскивание колонки шлёт только order, переименование
// только title, чтобы не пересылать вообще все поля ради одного изменившегося.
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
    const column = await prisma.taskColumn.update({
      where: { id: params.id },
      data: {
        ...(data.title !== undefined ? { title: String(data.title).trim() } : {}),
        ...(data.order !== undefined ? { order: Number(data.order) } : {}),
      },
    });
    return NextResponse.json(column);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось обновить колонку" },
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
    // Task.columnId -> onDelete: Cascade в схеме, задачи колонки удалятся сами.
    await prisma.taskColumn.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить колонку" },
      { status: 400 }
    );
  }
}
