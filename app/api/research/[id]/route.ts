import { NextRequest, NextResponse } from "next/server";
import { getApiTenantSession, unauthorizedResponse } from "@/lib/session";
import { runWithTenant } from "@/lib/tenantContext";
import { setCandidateStatus } from "@/lib/research";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getApiTenantSession();
  if (!session) return unauthorizedResponse();
  return runWithTenant(session, () => POSTContent(req, params.id));
}

async function POSTContent(req: NextRequest, id: string) {
  const data = await req.json().catch(() => ({}));
  const status = String(data.status ?? "");
  try {
    await setCandidateStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Не удалось обновить статус" }, { status: 400 });
  }
}
