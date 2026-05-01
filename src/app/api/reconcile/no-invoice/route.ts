import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { bankNoInvoiceApprovals } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * אישור אדמין שאין צורך בחשבונית עבור תנועה בנקאית.
 * (החזרי מס הכנסה, ביטוח לאומי, כסף שלקוח החזיר וכו').
 * חובה לרשום סיבה. רק אדמין.
 */

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "admin required" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { bankTransactionId?: number; reason?: string }
    | null;
  if (!body || typeof body.bankTransactionId !== "number" || !body.reason?.trim()) {
    return NextResponse.json(
      { error: "bankTransactionId + reason required" },
      { status: 400 }
    );
  }

  await db
    .insert(bankNoInvoiceApprovals)
    .values({
      bankTransactionId: body.bankTransactionId,
      reason: body.reason.trim(),
      approvedByUserId: session.userId!,
    })
    .onConflictDoUpdate({
      target: bankNoInvoiceApprovals.bankTransactionId,
      set: {
        reason: sql`excluded.reason`,
        approvedByUserId: sql`excluded.approved_by_user_id`,
        approvedAt: sql`(unixepoch())`,
      },
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "admin required" }, { status: 403 });

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("bankTransactionId"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bankTransactionId required" }, { status: 400 });
  }

  await db
    .delete(bankNoInvoiceApprovals)
    .where(eq(bankNoInvoiceApprovals.bankTransactionId, id));
  return NextResponse.json({ ok: true });
}
