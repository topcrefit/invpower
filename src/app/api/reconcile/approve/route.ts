import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { bankCardcomMatches } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * אישור ידני של התאמה בנק ↔ Cardcom.
 * POST   { bankTransactionId, cardcomInvoiceNumber, note? } — upsert
 * DELETE ?bankTransactionId=NN — מבטל אישור
 */

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  type ApproveItem = { bankTransactionId: number; cardcomInvoiceNumber: string; note?: string | null };
  const body = (await req.json().catch(() => null)) as
    | (ApproveItem & { items?: ApproveItem[] })
    | { items: ApproveItem[] }
    | null;
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const items: ApproveItem[] = Array.isArray((body as { items?: ApproveItem[] }).items)
    ? (body as { items: ApproveItem[] }).items
    : "bankTransactionId" in body
      ? [body as ApproveItem]
      : [];

  const valid = items.filter(
    (i) => typeof i.bankTransactionId === "number" && !!i.cardcomInvoiceNumber
  );
  if (valid.length === 0) {
    return NextResponse.json({ error: "no valid items" }, { status: 400 });
  }

  await db
    .insert(bankCardcomMatches)
    .values(
      valid.map((i) => ({
        bankTransactionId: i.bankTransactionId,
        cardcomInvoiceNumber: i.cardcomInvoiceNumber,
        note: i.note ?? null,
        approvedByUserId: session.userId!,
      }))
    )
    .onConflictDoUpdate({
      target: bankCardcomMatches.bankTransactionId,
      set: {
        cardcomInvoiceNumber: sql`excluded.cardcom_invoice_number`,
        note: sql`excluded.note`,
        approvedByUserId: sql`excluded.approved_by_user_id`,
        approvedAt: sql`(unixepoch())`,
      },
    });

  return NextResponse.json({ ok: true, approved: valid.length });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("bankTransactionId"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bankTransactionId required" }, { status: 400 });
  }

  await db.delete(bankCardcomMatches).where(eq(bankCardcomMatches.bankTransactionId, id));
  return NextResponse.json({ ok: true });
}
