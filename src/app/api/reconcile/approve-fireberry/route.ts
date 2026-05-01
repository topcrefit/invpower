import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { bankFireberryMatches } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * אישור ידני של התאמה בין תנועת בנק לרכישת Fireberry (שלב ב׳).
 * תומך באישור בודד או batch (items: [...]).
 */

type Item = {
  bankTransactionId: number;
  fireberryPurchaseId: number;
  note?: string | null;
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | (Item & { items?: Item[] })
    | null;
  if (!body) {
    return NextResponse.json({ error: "missing body" }, { status: 400 });
  }

  const items: Item[] =
    Array.isArray(body.items) && body.items.length > 0
      ? body.items
      : [
          {
            bankTransactionId: body.bankTransactionId,
            fireberryPurchaseId: body.fireberryPurchaseId,
            note: body.note ?? null,
          },
        ];

  for (const it of items) {
    if (
      typeof it.bankTransactionId !== "number" ||
      typeof it.fireberryPurchaseId !== "number"
    ) {
      return NextResponse.json(
        { error: "bankTransactionId + fireberryPurchaseId required" },
        { status: 400 }
      );
    }
  }

  let approved = 0;
  for (const it of items) {
    await db
      .insert(bankFireberryMatches)
      .values({
        bankTransactionId: it.bankTransactionId,
        fireberryPurchaseId: it.fireberryPurchaseId,
        note: it.note ?? null,
        approvedByUserId: session.userId,
      })
      .onConflictDoUpdate({
        target: bankFireberryMatches.bankTransactionId,
        set: {
          fireberryPurchaseId: sql`excluded.fireberry_purchase_id`,
          note: sql`excluded.note`,
          approvedByUserId: sql`excluded.approved_by_user_id`,
          approvedAt: sql`(unixepoch())`,
        },
      });
    approved++;
  }

  return NextResponse.json({ ok: true, approved });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session.userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("bankTransactionId"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json(
      { error: "bankTransactionId required" },
      { status: 400 }
    );
  }

  await db
    .delete(bankFireberryMatches)
    .where(eq(bankFireberryMatches.bankTransactionId, id));

  return NextResponse.json({ ok: true });
}
