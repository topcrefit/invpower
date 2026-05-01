import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { syncFireberryPurchases } from "@/lib/fireberry/sync";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await syncFireberryPurchases();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "sync failed" },
      { status: 500 }
    );
  }
}
