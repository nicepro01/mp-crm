import { NextRequest, NextResponse } from "next/server";
import { upsertImportItem } from "@/lib/matching";

type ImportLine = { mpSku: string; barcode?: string | null; name?: string | null };

export async function POST(req: NextRequest) {
  const data = await req.json();
  const marketplaceId: string | undefined = data.marketplaceId;
  const items: ImportLine[] = Array.isArray(data.items) ? data.items : [];

  if (!marketplaceId) {
    return NextResponse.json({ error: "Выберите площадку" }, { status: 400 });
  }
  if (items.length === 0) {
    return NextResponse.json({ error: "Список товаров пуст" }, { status: 400 });
  }

  const summary = { matchedListing: 0, matchedBarcode: 0, pending: 0, skipped: 0, total: 0 };

  for (const raw of items) {
    const mpSku = raw.mpSku?.trim();
    if (!mpSku) continue;
    summary.total++;

    const barcode = raw.barcode?.trim() || null;
    const name = raw.name?.trim() || null;

    const outcome = await upsertImportItem({ marketplaceId, mpSku, barcode, name });

    if (outcome.status === "matched" && outcome.matchedVia === "mp_listing") summary.matchedListing++;
    else if (outcome.status === "matched" && outcome.matchedVia === "barcode") summary.matchedBarcode++;
    else if (outcome.status === "pending") summary.pending++;
    else summary.skipped++;
  }

  return NextResponse.json(summary);
}
