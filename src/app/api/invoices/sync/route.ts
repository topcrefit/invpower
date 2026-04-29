import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { syncCardcomInvoices } from "@/lib/cardcom/sync";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fromStr = body?.from as string | undefined;
  const toStr = body?.to as string | undefined;
  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "from / to required" }, { status: 400 });
  }

  try {
    const result = await syncCardcomInvoices(
      new Date(fromStr + "T00:00:00"),
      new Date(toStr + "T23:59:59")
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "sync failed" },
      { status: 500 }
    );
  }
}
