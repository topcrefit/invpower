import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  fireberryPurchases,
  bankFireberryMatches,
} from "@/lib/db/schema";
import { and, gte, lte, asc, inArray, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { nameSimilarity, amountsEqual } from "@/lib/match/name-match";

export const runtime = "nodejs";

/**
 * Phase B (flipped) — מ-Fireberry לבנק.
 * 21 שורות רכישה (כל מה שעבר את 4 הכללים בסנכרון), ליד כל אחת:
 *   - האם הגיע הכסף בבנק? (התאמה ודאית/חלקית/אין)
 *   - אם כן: פרטי תנועת הבנק.
 * 1:1 — תנועת בנק שכבר נצמדה לרכישה אחת לא תיצמד לעוד.
 */

const DEFAULT_WINDOW_DAYS = 60;
const MS_DAY = 86400 * 1000;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const windowDays = Number(
    url.searchParams.get("window") ?? DEFAULT_WINDOW_DAYS
  );
  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: "from / to required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T23:59:59");

  const [fbRows, txRows] = await Promise.all([
    db
      .select()
      .from(fireberryPurchases)
      .where(eq(fireberryPurchases.invoiceStatusName, "לא נשלח"))
      .orderBy(asc(fireberryPurchases.createdOn)),
    db
      .select()
      .from(bankTransactions)
      .where(
        and(
          gte(bankTransactions.txDate, from),
          lte(bankTransactions.txDate, to)
        )
      ),
  ]);

  type BankMatch = {
    bankTransactionId: number;
    txDate: string;
    amount: number;
    extractedName: string | null;
    extractedAccount: string | null;
    reference: string | null;
    description: string | null;
    nameSimilarity: number;
    daysDiff: number;
    confidence: "high" | "medium";
    reason: string;
    approved?: boolean;
    note?: string | null;
  };

  type RowResult = {
    purchaseId: number;
    accountProductId: string;
    customerName: string | null;
    productName: string | null;
    invoiceLinesDescription: string | null;
    price: number | null;
    createdOn: string | null;
    invoiceStatusName: string | null;
    paymentTypeName: string | null;
    customerTaxId: string | null;
    customerPhone: string | null;
    customerEmail: string | null;
    bank: BankMatch | null;
    candidates: Array<{
      bankTransactionId: number;
      txDate: string;
      amount: number;
      extractedName: string | null;
      extractedAccount: string | null;
      reference: string | null;
      description: string | null;
      nameSimilarity: number;
      daysDiff: number;
      reason: string;
    }>;
  };

  const fbIds = fbRows.map((f) => f.id);
  const approvals =
    fbIds.length > 0
      ? await db
          .select()
          .from(bankFireberryMatches)
          .where(inArray(bankFireberryMatches.fireberryPurchaseId, fbIds))
      : [];
  const approvalByFb = new Map(
    approvals.map((a) => [a.fireberryPurchaseId, a])
  );
  const txById = new Map(txRows.map((t) => [t.id, t]));

  const usedTx = new Set<number>();
  for (const a of approvals) usedTx.add(a.bankTransactionId);

  const result: RowResult[] = [];

  for (const fb of fbRows) {
    const fbTime = fb.createdOn ? new Date(fb.createdOn).getTime() : 0;
    const fbName = fb.customerName ?? "";

    const approved = approvalByFb.get(fb.id);
    if (approved) {
      const tx = txById.get(approved.bankTransactionId);
      const tTime = tx ? new Date(tx.txDate).getTime() : fbTime;
      const daysDiff = Math.abs(tTime - fbTime) / MS_DAY;
      const sim = tx ? nameSimilarity(fbName, tx.extractedName ?? "") : 0;
      result.push({
        purchaseId: fb.id,
        accountProductId: fb.accountProductId,
        customerName: fb.customerName,
        productName: fb.productName,
        invoiceLinesDescription: fb.invoiceLinesDescription,
        price: fb.price,
        createdOn: fb.createdOn ? fb.createdOn.toISOString() : null,
        invoiceStatusName: fb.invoiceStatusName,
        paymentTypeName: fb.paymentTypeName,
        customerTaxId: fb.customerTaxId,
        customerPhone: fb.customerPhone,
        customerEmail: fb.customerEmail,
        bank: tx
          ? {
              bankTransactionId: tx.id,
              txDate: tx.txDate.toISOString(),
              amount: tx.amount,
              extractedName: tx.extractedName,
              extractedAccount: tx.extractedAccount,
              reference: tx.reference,
              description: tx.description,
              nameSimilarity: sim,
              daysDiff: Math.round(daysDiff),
              confidence: "high",
              reason: approved.note
                ? `אושר ידנית — ${approved.note}`
                : "אושר ידנית",
              approved: true,
              note: approved.note,
            }
          : null,
        candidates: [],
      });
      continue;
    }

    if (fb.price == null || fb.createdOn == null) {
      result.push({
        purchaseId: fb.id,
        accountProductId: fb.accountProductId,
        customerName: fb.customerName,
        productName: fb.productName,
        invoiceLinesDescription: fb.invoiceLinesDescription,
        price: fb.price,
        createdOn: fb.createdOn ? new Date(fb.createdOn).toISOString() : null,
        invoiceStatusName: fb.invoiceStatusName,
        paymentTypeName: fb.paymentTypeName,
        customerTaxId: fb.customerTaxId,
        customerPhone: fb.customerPhone,
        customerEmail: fb.customerEmail,
        bank: null,
        candidates: [],
      });
      continue;
    }

    let bestMatch: BankMatch | null = null;
    let bestScore = -1;
    const candidates: RowResult["candidates"] = [];

    for (const tx of txRows) {
      if (usedTx.has(tx.id)) continue;
      const tTime = new Date(tx.txDate).getTime();
      const daysDiff = Math.abs(tTime - fbTime) / MS_DAY;

      const amountMatch = amountsEqual(tx.amount, fb.price);
      const sim = nameSimilarity(fbName, tx.extractedName ?? "");
      const inWindow = daysDiff <= windowDays;
      const inExtendedWindow = daysDiff <= windowDays + 7;

      if (amountMatch && inWindow && sim >= 0.9) {
        const score = 100 + sim * 10 - daysDiff;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            bankTransactionId: tx.id,
            txDate: tx.txDate.toISOString(),
            amount: tx.amount,
            extractedName: tx.extractedName,
            extractedAccount: tx.extractedAccount,
            reference: tx.reference,
            description: tx.description,
            nameSimilarity: sim,
            daysDiff: Math.round(daysDiff),
            confidence: "high",
            reason: `סכום מדויק + שם ${(sim * 100).toFixed(0)}% + ${Math.round(daysDiff)} ימים`,
          };
        }
      } else if (amountMatch && inExtendedWindow && sim >= 0.55) {
        const score = 50 + sim * 10 - daysDiff;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            bankTransactionId: tx.id,
            txDate: tx.txDate.toISOString(),
            amount: tx.amount,
            extractedName: tx.extractedName,
            extractedAccount: tx.extractedAccount,
            reference: tx.reference,
            description: tx.description,
            nameSimilarity: sim,
            daysDiff: Math.round(daysDiff),
            confidence: "medium",
            reason: `סכום מדויק + שם ${(sim * 100).toFixed(0)}% + ${Math.round(daysDiff)} ימים`,
          };
        }
      }

      if (!amountMatch || sim < 0.7) {
        const amountDelta =
          fb.price && tx.amount !== 0
            ? Math.abs(fb.price - tx.amount) / Math.abs(tx.amount)
            : 1;
        if (
          (amountMatch || amountDelta < 0.05) &&
          (sim > 0.5 || amountMatch) &&
          inExtendedWindow
        ) {
          candidates.push({
            bankTransactionId: tx.id,
            txDate: tx.txDate.toISOString(),
            amount: tx.amount,
            extractedName: tx.extractedName,
            extractedAccount: tx.extractedAccount,
            reference: tx.reference,
            description: tx.description,
            nameSimilarity: sim,
            daysDiff: Math.round(daysDiff),
            reason: amountMatch
              ? `סכום מדויק | שם ${(sim * 100).toFixed(0)}% | ${Math.round(daysDiff)} ימים`
              : `סכום קרוב (${tx.amount.toFixed(0)}) | שם ${(sim * 100).toFixed(0)}% | ${Math.round(daysDiff)} ימים`,
          });
        }
      }
    }

    if (bestMatch) usedTx.add(bestMatch.bankTransactionId);
    candidates.sort(
      (a, b) => b.nameSimilarity - a.nameSimilarity || a.daysDiff - b.daysDiff
    );

    result.push({
      purchaseId: fb.id,
      accountProductId: fb.accountProductId,
      customerName: fb.customerName,
      productName: fb.productName,
      invoiceLinesDescription: fb.invoiceLinesDescription,
      price: fb.price,
      createdOn: fb.createdOn.toISOString(),
      invoiceStatusName: fb.invoiceStatusName,
      paymentTypeName: fb.paymentTypeName,
      customerTaxId: fb.customerTaxId,
      customerPhone: fb.customerPhone,
      customerEmail: fb.customerEmail,
      bank: bestMatch,
      candidates: bestMatch ? [] : candidates.slice(0, 3),
    });
  }

  const high = result.filter((r) => r.bank?.confidence === "high");
  const medium = result.filter((r) => r.bank?.confidence === "medium");
  const unmatched = result.filter((r) => !r.bank);

  const totalAmount = result.reduce((s, r) => s + (r.price ?? 0), 0);
  const matchedAmount = result
    .filter((r) => r.bank)
    .reduce((s, r) => s + (r.price ?? 0), 0);

  return NextResponse.json({
    ok: true,
    rows: result,
    summary: {
      total: result.length,
      high: high.length,
      medium: medium.length,
      unmatched: unmatched.length,
      totalAmount,
      matchedAmount,
      unmatchedAmount: totalAmount - matchedAmount,
    },
    config: { windowDays },
  });
}
