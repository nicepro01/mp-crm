import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant, getCurrentCompanyId } from "@/lib/tenantContext";
import { getSupabaseAdmin, PRODUCT_PHOTOS_BUCKET, TASK_ATTACHMENTS_FOLDER } from "@/lib/supabase";

// Вложения к задаче — гораздо шире, чем фото товара (документы/таблицы/
// архивы, не только картинки), но не что попало — минимальный allow-list,
// чтобы не превращать Storage в свалку произвольных бинарников.
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "application/zip",
];
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 МБ

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req, { params }));
}

async function POSTContent(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const formData = await req.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Файл не передан" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Этот тип файла не поддерживается" },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Файл больше 20 МБ" }, { status: 400 });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const storagePath = `${TASK_ATTACHMENTS_FOLDER}/${params.id}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabaseAdmin.storage
    .from(PRODUCT_PHOTOS_BUCKET)
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 400 });
  }

  const { data } = supabaseAdmin.storage.from(PRODUCT_PHOTOS_BUCKET).getPublicUrl(storagePath);

  try {
    const attachment = await prisma.taskAttachment.create({
      data: {
        companyId: getCurrentCompanyId(),
        taskId: params.id,
        fileName: file.name,
        storagePath,
        url: data.publicUrl,
        fileSize: file.size,
        mimeType: file.type,
      },
    });
    return NextResponse.json(attachment, { status: 201 });
  } catch (err: any) {
    // Файл уже успел загрузиться в Storage, а строка в БД — нет: подчищаем,
    // чтобы не плодить осиротевшие файлы без ссылки на них.
    await supabaseAdmin.storage.from(PRODUCT_PHOTOS_BUCKET).remove([storagePath]);
    return NextResponse.json(
      { error: err.message ?? "Не удалось сохранить вложение" },
      { status: 400 }
    );
  }
}
