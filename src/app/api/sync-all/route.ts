import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { syncCardcomInvoices } from "@/lib/cardcom/sync";
import { syncFireberryPurchases } from "@/lib/fireberry/sync";

export const runtime = "nodejs";

/**
 * סנכרון אחד לכל המערכות:
 * - Cardcom (חשבוניות שכבר הופקו)
 * - Fireberry (רכישות לא נשלח)
 * הבנק לא צריך סנכרון — נטען מהעלאת Excel.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const fromStr = body?.from as string | undefined;
  const toStr = body?.to as string | undefined;
  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: "from / to required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const results: {
    cardcom: { ok: boolean; total?: number; error?: string };
    fireberry: { ok: boolean; total?: number; error?: string };
  } = {
    cardcom: { ok: false },
    fireberry: { ok: false },
  };

  // 1. Cardcom
  try {
    const cc = await syncCardcomInvoices(
      new Date(fromStr + "T00:00:00"),
      new Date(toStr + "T23:59:59")
    );
    results.cardcom = { ok: true, total: cc.total };
  } catch (e) {
    results.cardcom = {
      ok: false,
      error: e instanceof Error ? e.message : "Cardcom sync failed",
    };
  }

  // 2. Fireberry
  try {
    const fb = await syncFireberryPurchases();
    results.fireberry = { ok: true, total: fb.total };
  } catch (e) {
    results.fireberry = {
      ok: false,
      error: e instanceof Error ? e.message : "Fireberry sync failed",
    };
  }

  return NextResponse.json({ ok: true, ...results });
}
