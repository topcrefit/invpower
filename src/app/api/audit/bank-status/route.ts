import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  fireberryPurchases,
  issuedInvoices,
  cardcomInvoices,
  bankNoInvoiceApprovals,
} from "@/lib/db/schema";
import { and, gte, lte, asc, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { nameSimilarity, amountsEqual } from "@/lib/match/name-match";

export const runtime = "nodejs";

/**
 * דוח ביקורת בנק-centric:
 * לכל תנועת בנק — האם יש רשומה ב-Fireberry "לא נשלח"?
 * - יש → מוכן להפקת חשבונית
 * - אין → אין חשבונית (או שכבר הופקה דרך אחרת)
 */
const MS_DAY = 86400 * 1000;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  if (!fromStr || !toStr) {
    return NextResponse.json(
      { error: "from / to required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T23:59:59");

  // 1. כל תנועות הבנק בטווח
  const txRows = await db
    .select()
    .from(bankTransactions)
    .where(
      and(gte(bankTransactions.txDate, from), lte(bankTransactions.txDate, to))
    )
    .orderBy(asc(bankTransactions.txDate));

  // 2. כל רשומות Fireberry (גם "לא נשלח" וגם "נשלח")
  const fbAll = await db.select().from(fireberryPurchases);
  const fbNotSent = fbAll.filter((r) => r.invoiceStatusName === "לא נשלח");
  const fbSent = fbAll.filter((r) => r.invoiceStatusName === "נשלח");

  // 3. issued_invoices — חשבוניות שכבר הופקו על תנועות בנק
  const issuedRows = await db.select().from(issuedInvoices);
  const issuedByTxId = new Map<number, (typeof issuedRows)[number]>();
  for (const i of issuedRows) {
    if (i.status === "issued" || i.status === "partial") {
      issuedByTxId.set(i.bankTransactionId, i);
    }
  }

  // 4. כל החשבוניות שכבר הונפקו ב-Cardcom (מהמטמון המקומי)
  const cardcomRows = await db.select().from(cardcomInvoices);

  // 5. אישורי אדמין "אין צורך בחשבונית" (Tranzila / משכורת / החזרי מס וכו')
  const approvalRows = await db.select().from(bankNoInvoiceApprovals);
  const approvalByTxId = new Map(
    approvalRows.map((a) => [a.bankTransactionId, a])
  );

  // 5. matching: לכל תנועת בנק
  type RowResult = {
    bankTransactionId: number;
    txDate: string;
    valueDate: string | null;
    description: string | null;
    reference: string | null;
    amount: number;
    extendedDescription: string | null;
    extractedName: string | null;
    extractedAccount: string | null;
    note: string | null;
    status: "ready_to_issue" | "already_issued" | "admin_approved" | "no_match";
    adminApproval: { reason: string; approvedAt: string | null } | null;
    fireberry: {
      purchaseId: number;
      accountProductId: string;
      accountId: string | null;
      customerName: string | null;
      customerTaxId: string | null;
      customerPhone: string | null;
      productDescription: string | null;
      price: number | null;
      createdOn: string | null;
      nameSimilarity: number;
      daysDiff: number;
    } | null;
    cardcomMatch: {
      invoiceNumber: string;
      invoiceDate: string | null;
      customerName: string | null;
      total: number | null;
      nameSimilarity: number;
    } | null;
    issuedInvoice: {
      invoiceNumber: string | null;
      invoiceLink: string | null;
      issuedAt: string | null;
    } | null;
  };

  const usedFb = new Set<number>();
  const usedCardcom = new Set<number>();
  const result: RowResult[] = [];

  // ===================================================================
  // STAGE 1 — Fireberry "לא נשלח": שיוך גלובלי לפי ניקוד דמיון+קרבת תאריך
  // הניקוד: sim*100 + (DAYS_WINDOW - daysDiff)*10
  // → 1 יום הבדל בתאריך = 60 נק' (שווה ערך לפער דמיון של 0.6)
  // → 7 יום הבדל = 0 נק' תאריך (סף קשיח)
  // יוצרים את כל הזוגות האפשריים, ממיינים יורד, ומקצים בלעדי.
  // ===================================================================
  const NOTSENT_DAYS_WINDOW = 7;
  type FbPair = {
    txId: number;
    fbId: number;
    sim: number;
    daysDiff: number;
    score: number;
  };
  const fbCandidates: FbPair[] = [];
  for (const tx of txRows) {
    if (issuedByTxId.get(tx.id)) continue;
    const txTime = new Date(tx.txDate).getTime();
    const txName = tx.extractedName ?? "";
    for (const fb of fbNotSent) {
      if (fb.price == null) continue;
      if (!amountsEqual(tx.amount, fb.price)) continue;
      const fbTime = fb.createdOn ? new Date(fb.createdOn).getTime() : txTime;
      const daysDiff = Math.abs(fbTime - txTime) / MS_DAY;
      if (daysDiff > NOTSENT_DAYS_WINDOW) continue;
      const sim = nameSimilarity(txName, fb.customerName ?? "");
      if (sim < 0.5) continue;
      const score = sim * 100 + (NOTSENT_DAYS_WINDOW - daysDiff) * 10;
      fbCandidates.push({ txId: tx.id, fbId: fb.id, sim, daysDiff, score });
    }
  }
  fbCandidates.sort((a, b) => b.score - a.score);
  const fbAssignment = new Map<number, FbPair>(); // txId -> pair
  for (const c of fbCandidates) {
    if (fbAssignment.has(c.txId)) continue;
    if (usedFb.has(c.fbId)) continue;
    fbAssignment.set(c.txId, c);
    usedFb.add(c.fbId);
  }

  // ===================================================================
  // STAGE 2 — Cardcom: שיוך גלובלי דומה (סף 0.5 דמיון, ללא תאריך כי
  // ב-cardcom יש לנו תאריך הפקה ולא בהכרח תאריך תשלום בנק)
  // ===================================================================
  type CcPair = { txId: number; ccId: number; sim: number };
  const ccCandidates: CcPair[] = [];
  for (const tx of txRows) {
    if (issuedByTxId.get(tx.id)) continue;
    if (fbAssignment.has(tx.id)) continue;
    const txName = tx.extractedName ?? "";
    for (const cc of cardcomRows) {
      if (cc.totalIncludeVat == null) continue;
      if (!amountsEqual(tx.amount, cc.totalIncludeVat)) continue;
      const sim = nameSimilarity(txName, cc.customerName ?? "");
      if (sim < 0.5) continue;
      ccCandidates.push({ txId: tx.id, ccId: cc.id, sim });
    }
  }
  ccCandidates.sort((a, b) => b.sim - a.sim);
  const ccAssignment = new Map<number, CcPair>();
  for (const c of ccCandidates) {
    if (ccAssignment.has(c.txId)) continue;
    if (usedCardcom.has(c.ccId)) continue;
    ccAssignment.set(c.txId, c);
    usedCardcom.add(c.ccId);
  }

  // ===================================================================
  // STAGE 3 — Fireberry "נשלח": שיוך גלובלי לפי ניקוד דמיון+תאריך
  // ===================================================================
  const SENT_DAYS_WINDOW = 14;
  const fbSentCandidates: FbPair[] = [];
  for (const tx of txRows) {
    if (issuedByTxId.get(tx.id)) continue;
    if (fbAssignment.has(tx.id)) continue;
    if (ccAssignment.has(tx.id)) continue;
    const txTime = new Date(tx.txDate).getTime();
    const txName = tx.extractedName ?? "";
    for (const fb of fbSent) {
      if (usedFb.has(fb.id)) continue;
      if (fb.price == null) continue;
      if (!amountsEqual(tx.amount, fb.price)) continue;
      const fbTime = fb.createdOn ? new Date(fb.createdOn).getTime() : txTime;
      const daysDiff = Math.abs(fbTime - txTime) / MS_DAY;
      if (daysDiff > SENT_DAYS_WINDOW) continue;
      const sim = nameSimilarity(txName, fb.customerName ?? "");
      if (sim < 0.5) continue;
      const score = sim * 100 + (SENT_DAYS_WINDOW - daysDiff) * 5;
      fbSentCandidates.push({ txId: tx.id, fbId: fb.id, sim, daysDiff, score });
    }
  }
  fbSentCandidates.sort((a, b) => b.score - a.score);
  const fbSentAssignment = new Map<number, FbPair>();
  for (const c of fbSentCandidates) {
    if (fbSentAssignment.has(c.txId)) continue;
    if (usedFb.has(c.fbId)) continue;
    fbSentAssignment.set(c.txId, c);
    usedFb.add(c.fbId);
  }

  // אינדקסים מהירים לבניית התוצאה
  const fbById = new Map(fbAll.map((f) => [f.id, f]));
  const ccById = new Map(cardcomRows.map((c) => [c.id, c]));

  for (const tx of txRows) {
    const issuedRecord = issuedByTxId.get(tx.id);
    const adminAppr = approvalByTxId.get(tx.id);

    const fbPair = fbAssignment.get(tx.id);
    const bestFb = fbPair ? fbById.get(fbPair.fbId) ?? null : null;
    const bestSim = fbPair?.sim ?? 0;
    const bestDays = fbPair?.daysDiff ?? 999;

    const ccPair = ccAssignment.get(tx.id);
    const cardcomBest = ccPair ? ccById.get(ccPair.ccId) ?? null : null;
    const cardcomBestSim = ccPair?.sim ?? 0;

    const fbSentPair = fbSentAssignment.get(tx.id);
    const fbSentBest = fbSentPair ? fbById.get(fbSentPair.fbId) ?? null : null;

    let status: RowResult["status"];
    if (adminAppr) status = "admin_approved";
    else if (issuedRecord || cardcomBest || fbSentBest) status = "already_issued";
    else if (bestFb) status = "ready_to_issue";
    else status = "no_match";

    result.push({
      bankTransactionId: tx.id,
      txDate: tx.txDate.toISOString(),
      valueDate: tx.valueDate ? tx.valueDate.toISOString() : null,
      description: tx.description,
      reference: tx.reference,
      amount: tx.amount,
      extendedDescription: tx.extendedDescription,
      extractedName: tx.extractedName,
      extractedAccount: tx.extractedAccount,
      note: tx.note,
      status,
      fireberry: bestFb
        ? {
            purchaseId: bestFb.id,
            accountProductId: bestFb.accountProductId,
            accountId: bestFb.accountId,
            customerName: bestFb.customerName,
            customerTaxId: bestFb.customerTaxId,
            customerPhone: bestFb.customerPhone,
            productDescription: bestFb.invoiceLinesDescription ?? bestFb.productName,
            price: bestFb.price,
            createdOn: bestFb.createdOn ? bestFb.createdOn.toISOString() : null,
            nameSimilarity: bestSim,
            daysDiff: Math.round(bestDays),
          }
        : null,
      cardcomMatch: cardcomBest
        ? {
            invoiceNumber: cardcomBest.invoiceNumber,
            invoiceDate: cardcomBest.invoiceDate ? cardcomBest.invoiceDate.toISOString() : null,
            customerName: cardcomBest.customerName,
            total: cardcomBest.totalIncludeVat,
            nameSimilarity: cardcomBestSim,
          }
        : null,
      issuedInvoice: issuedRecord
        ? {
            invoiceNumber: issuedRecord.cardcomInvoiceNumber,
            invoiceLink: issuedRecord.cardcomInvoiceLink,
            issuedAt: issuedRecord.issuedAt ? issuedRecord.issuedAt.toISOString() : null,
          }
        : null,
      adminApproval: adminAppr
        ? {
            reason: adminAppr.reason,
            approvedAt: adminAppr.approvedAt
              ? adminAppr.approvedAt.toISOString()
              : null,
          }
        : null,
    });
  }

  // סיכומים
  const ready = result.filter((r) => r.status === "ready_to_issue");
  const issued = result.filter((r) => r.status === "already_issued");
  const adminAppr = result.filter((r) => r.status === "admin_approved");
  const noMatch = result.filter((r) => r.status === "no_match");

  return NextResponse.json({
    ok: true,
    rows: result,
    summary: {
      total: result.length,
      readyToIssue: ready.length,
      alreadyIssued: issued.length,
      adminApproved: adminAppr.length,
      noMatch: noMatch.length,
      readyAmount: ready.reduce((s, r) => s + r.amount, 0),
      issuedAmount: issued.reduce((s, r) => s + r.amount, 0),
      adminApprovedAmount: adminAppr.reduce((s, r) => s + r.amount, 0),
      noMatchAmount: noMatch.reduce((s, r) => s + r.amount, 0),
    },
  });
}
