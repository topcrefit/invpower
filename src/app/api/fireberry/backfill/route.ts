import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { backfillFireberryAccountInfo } from "@/lib/fireberry/backfill";

export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await backfillFireberryAccountInfo();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
