import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  cardcomInvoices,
  bankCardcomMatches,
} from "@/lib/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { nameSimilarity, amountsEqual } from "@/lib/match/name-match";

export const runtime = "nodejs";

/**
 * דיבאג: למה חשבונית X לא הוצגה לתנועת בנק Y?
 * GET ?bankTransactionId=NN&invoiceNumber=MM
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const bankTxId = Number(url.searchParams.get("bankTransactionId"));
  const txDateStr = url.searchParams.get("txDate"); // YYYY-MM-DD
  const amountStr = url.searchParams.get("amount");
  const invoiceNumber = url.searchParams.get("invoiceNumber");
  if (!invoiceNumber) {
    return NextResponse.json({ error: "invoiceNumber required" }, { status: 400 });
  }

  let tx: typeof bankTransactions.$inferSelect | undefined;
  if (Number.isFinite(bankTxId) && bankTxId > 0) {
    [tx] = await db.select().from(bankTransactions).where(eq(bankTransactions.id, bankTxId));
  } else if (txDateStr && amountStr) {
    const day = new Date(txDateStr + "T00:00:00");
    const next = new Date(day.getTime() + 86400000);
    const amt = Number(amountStr);
    const cands = await db
      .select()
      .from(bankTransactions)
      .where(
        and(
          gte(bankTransactions.txDate, day),
          lte(bankTransactions.txDate, next),
          eq(bankTransactions.amount, amt)
        )
      );
    tx = cands[0];
  } else {
    return NextResponse.json(
      { error: "provide bankTransactionId, OR txDate+amount" },
      { status: 400 }
    );
  }
  const [inv] = await db
    .select()
    .from(cardcomInvoices)
    .where(eq(cardcomInvoices.invoiceNumber, invoiceNumber));

  if (!tx) return NextResponse.json({ error: "tx not found" }, { status: 404 });
  if (!inv) return NextResponse.json({ error: "invoice not found in DB" }, { status: 404 });

  const txTime = new Date(tx.txDate).getTime();
  const cTime = inv.invoiceDate ? new Date(inv.invoiceDate).getTime() : null;
  const daysDiff = cTime ? Math.abs(cTime - txTime) / 86400000 : null;
  const amountMatch =
    inv.totalIncludeVat != null ? amountsEqual(tx.amount, inv.totalIncludeVat) : false;
  const amountDelta =
    inv.totalIncludeVat != null && tx.amount !== 0
      ? Math.abs(inv.totalIncludeVat - tx.amount) / tx.amount
      : null;
  const sim = nameSimilarity(tx.extractedName ?? "", inv.customerName ?? "");

  // האם החשבונית כבר תפוסה על ידי תנועה אחרת (אישור ידני)?
  const claimedByApproval = await db
    .select()
    .from(bankCardcomMatches)
    .where(eq(bankCardcomMatches.cardcomInvoiceNumber, invoiceNumber));

  return NextResponse.json({
    tx: {
      id: tx.id,
      txDate: tx.txDate.toISOString(),
      amount: tx.amount,
      extractedName: tx.extractedName,
      reference: tx.reference,
    },
    invoice: {
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate?.toISOString(),
      totalIncludeVat: inv.totalIncludeVat,
      customerName: inv.customerName,
      customerId: inv.customerId,
    },
    diagnostics: {
      amountMatch,
      amountDelta: amountDelta != null ? +(amountDelta * 100).toFixed(2) + "%" : null,
      daysDiff: daysDiff != null ? Math.round(daysDiff) : null,
      nameSimilarity: +(sim * 100).toFixed(0) + "%",
      claimedByApproval: claimedByApproval.length > 0
        ? claimedByApproval.map((a) => ({
            bankTransactionId: a.bankTransactionId,
            note: a.note,
          }))
        : null,
    },
    rules: {
      high: "amount exact + sim ≥ 90% + ≤ window days",
      medium: "amount exact + sim ≥ 55% + ≤ window+7 days",
      candidate:
        "(amount exact OR amount delta < 5%) AND (sim > 50% OR amount exact) AND ≤ window+7 days",
      blocked:
        "if cardcom invoice already used by another match (algorithmic or manual approval) — skipped entirely",
    },
  });
}
