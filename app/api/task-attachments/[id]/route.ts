import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { getSupabaseAdmin, PRODUCT_PHOTOS_BUCKET } from "@/lib/supabase";

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
    const attachment = await prisma.taskAttachment.delete({ where: { id: params.id } });
    try {
      const supabaseAdmin = getSupabaseAdmin();
      await supabaseAdmin.storage.from(PRODUCT_PHOTOS_BUCKET).remove([attachment.storagePath]);
    } catch {
      // Строка в БД уже удалена — если сам файл в Storage не удалился
      // (например, не настроены переменные окружения), это не должно
      // мешать пользователю продолжать работать с задачей.
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message ?? "Не удалось удалить вложение" },
      { status: 400 }
    );
  }
}
