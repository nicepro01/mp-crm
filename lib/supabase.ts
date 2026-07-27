import { createClient } from "@supabase/supabase-js";

export const PRODUCT_PHOTOS_BUCKET = "product-photos";

// Вложения задач лежат в том же bucket, что и фото товаров, просто в своей
// папке (task-attachments/...) — заводить отдельный bucket в Supabase ради
// этого не нужно, а public URL уже настроен один раз для всего bucket.
export const TASK_ATTACHMENTS_FOLDER = "task-attachments";

/**
 * Загрузка фото идёт только через серверный API-роут (service role key,
 * никогда не попадает в браузер) — так не нужно настраивать Storage RLS
 * policies на bucket, чтобы разрешить запись.
 */
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Не настроены SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY в .env — загрузка фото недоступна"
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
