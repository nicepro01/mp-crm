import { NextRequest, NextResponse } from "next/server";

// Временный диагностический роут — проверяет, может ли сервер Vercel
// достучаться до стороннего OData-эндпоинта 1С (локальная песочница не
// может из-за сетевых особенностей). Ничего не хранит, credentials приходят
// в теле запроса, а не хардкожены в файле. Удалить после проверки.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { url, user, pass } = body as { url?: string; user?: string; pass?: string };
  if (!url || !user || !pass) {
    return NextResponse.json({ error: "url, user, pass обязательны" }, { status: 400 });
  }

  try {
    const auth = Buffer.from(`${user}:${pass}`).toString("base64");
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    return NextResponse.json({
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type"),
      bodySnippet: text.slice(0, 2000),
    });
  } catch (err: any) {
    const cause = err?.cause;
    return NextResponse.json(
      {
        error: err?.message ?? String(err),
        name: err?.name,
        causeMessage: cause?.message,
        causeName: cause?.name,
        causeCode: cause?.code,
        causeErrno: cause?.errno,
      },
      { status: 500 }
    );
  }
}
