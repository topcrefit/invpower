import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  fireberryPurchases,
  issuedInvoices,
} from "@/lib/db/schema";
import { and, gte, lte, asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { findExistingCardcomInvoice } from "@/lib/invoices/check-duplicates";
import { scoreMatch } from "@/lib/match/name-match";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "from / to required (YYYY-MM-DD)" }, { status: 400 });
  }
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T23:59:59");

  // Bank txs בטווח
  const txRows = await db
    .select()
    .from(bankTransactions)
    .where(and(gte(bankTransactions.txDate, from), lte(bankTransactions.txDate, to)))
    .orderBy(asc(bankTransactions.txDate));

  // כל הרכישות מ-Fireberry — נסנן בזיכרון לפי סכום ושם
  const fbRows = await db.select().from(fireberryPurchases);

  // Issued invoices קיימות
  const ourIssued = await db.select().from(issuedInvoices);
  const issuedByTx = new Map<number, typeof ourIssued[number]>();
  for (const i of ourIssued) {
    const cur = issuedByTx.get(i.bankTransactionId);
    if (!cur || (cur.status !== "issued" && i.status === "issued")) {
      issuedByTx.set(i.bankTransactionId, i);
    }
  }

  const result = [];
  for (const tx of txRows) {
    const ours = issuedByTx.get(tx.id) ?? null;

    // הצעות התאמה מ-Fireberry: סכום מדויק + שם דומה ≥ 0.6
    const suggestions: Array<{
      purchaseId: number;
      accountProductId: string;
      accountId: string | null;
      customerName: string | null;
      productName: string | null;
      price: number | null;
      customerTaxId: string | null;
      similarity: number;
      reason: string;
    }> = [];
    for (const f of fbRows) {
      const score = scoreMatch(tx.amount, tx.extractedName, f.price, f.customerName);
      if (!score) continue;
      suggestions.push({
        purchaseId: f.id,
        accountProductId: f.accountProductId,
        accountId: f.accountId,
        customerName: f.customerName,
        productName: f.productName,
        price: f.price,
        customerTaxId: f.customerTaxId,
        similarity: score.nameSimilarity,
        reason: score.reason,
      });
    }
    suggestions.sort((a, b) => b.similarity - a.similarity);

    // קיים ב-Cardcom (מטמון)?
    let cardcomMatch: { invoiceNumber: string; reason: string } | null = null;
    if (!ours) {
      cardcomMatch = await findExistingCardcomInvoice(
        tx.amount,
        tx.extractedName,
        tx.txDate
      );
    }

    result.push({
      id: tx.id,
      txDate: tx.txDate,
      amount: tx.amount,
      reference: tx.reference,
      description: tx.description,
      extractedName: tx.extractedName,
      extractedAccount: tx.extractedAccount,
      extendedDescription: tx.extendedDescription,
      ourIssued: ours
        ? {
            id: ours.id,
            status: ours.status,
            invoiceNumber: ours.cardcomInvoiceNumber,
            invoiceLink: ours.cardcomInvoiceLink,
            uploadStatus: ours.fireberryUploadStatus,
          }
        : null,
      cardcomExisting: cardcomMatch,
      suggestions,
    });
  }

  return NextResponse.json({ ok: true, transactions: result });
}
