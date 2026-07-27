import sharp from "sharp";

const PHOTO_SIZE_PX = 64;

/** Фото товара для вставки в Excel — ExcelJS понимает только jpeg/png/gif,
 * а наши фото часто webp, поэтому всегда конвертируем через sharp. */
export async function fetchPhotoPng(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return await sharp(buffer)
      .resize(PHOTO_SIZE_PX, PHOTO_SIZE_PX, { fit: "cover" })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

export const EXCEL_PHOTO_SIZE_PX = PHOTO_SIZE_PX;
