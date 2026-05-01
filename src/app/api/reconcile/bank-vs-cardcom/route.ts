import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  cardcomInvoices,
  bankCardcomMatches,
  bankNoInvoiceApprovals,
} from "@/lib/db/schema";
import { and, gte, lte, asc, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { nameSimilarity, amountsEqual } from "@/lib/match/name-match";

export const runtime = "nodejs";

/**
 * Phase A — בנק ↔ Cardcom.
 * לכל תנועת בנק: מאתר את החשבונית ב-Cardcom שהופקה עבור הכסף הזה.
 * אם אין → ⚠ קיבלת כסף בלי להפיק חשבונית.
 */

const DEFAULT_WINDOW_DAYS = 60;
const MS_DAY = 86400 * 1000;

function normalizeTaxId(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const windowDays = Number(url.searchParams.get("window") ?? DEFAULT_WINDOW_DAYS);
  if (!fromStr || !toStr) {
    return NextResponse.json({ error: "from / to required (YYYY-MM-DD)" }, { status: 400 });
  }
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T23:59:59");

  // טוען בנק בטווח, Cardcom בטווח רחב יותר (כדי לתפוס חשבוניות שהופקו לפני/אחרי)
  const cardcomBufferMs = (windowDays + 7) * MS_DAY;
  const cardcomFrom = new Date(from.getTime() - cardcomBufferMs);
  const cardcomTo = new Date(to.getTime() + cardcomBufferMs);

  const [txRows, cardcomRows] = await Promise.all([
    db
      .select()
      .from(bankTransactions)
      .where(and(gte(bankTransactions.txDate, from), lte(bankTransactions.txDate, to)))
      .orderBy(asc(bankTransactions.txDate)),
    db
      .select()
      .from(cardcomInvoices)
      .where(and(gte(cardcomInvoices.invoiceDate, cardcomFrom), lte(cardcomInvoices.invoiceDate, cardcomTo))),
  ]);

  type Match = {
    invoiceNumber: string;
    invoiceDate: string;
    customerName: string | null;
    customerId: string | null;
    totalIncludeVat: number | null;
    nameSimilarity: number;
    daysDiff: number;
    confidence: "high" | "medium";
    reason: string;
    approved?: boolean;
    note?: string | null;
  };

  type RowResult = {
    id: number;
    txDate: string;
    amount: number;
    extractedName: string | null;
    extractedAccount: string | null;
    reference: string | null;
    description: string | null;
    match: Match | null;
    noInvoiceApproval: { reason: string; approvedAt: string } | null;
    candidates: Array<{
      invoiceNumber: string;
      invoiceDate: string;
      customerName: string | null;
      customerId: string | null;
      totalIncludeVat: number | null;
      nameSimilarity: number;
      daysDiff: number;
      reason: string;
    }>;
  };

  // אישורים ידניים — overrides any algorithmic match
  const txIds = txRows.map((t) => t.id);
  const [approvals, noInvoiceApprovals] = await Promise.all([
    txIds.length > 0
      ? db
          .select()
          .from(bankCardcomMatches)
          .where(inArray(bankCardcomMatches.bankTransactionId, txIds))
      : Promise.resolve([]),
    txIds.length > 0
      ? db
          .select()
          .from(bankNoInvoiceApprovals)
          .where(inArray(bankNoInvoiceApprovals.bankTransactionId, txIds))
      : Promise.resolve([]),
  ]);
  const approvalByTx = new Map(approvals.map((a) => [a.bankTransactionId, a]));
  const noInvoiceByTx = new Map(
    noInvoiceApprovals.map((a) => [a.bankTransactionId, a])
  );
  const cardcomByNumber = new Map(cardcomRows.map((c) => [c.invoiceNumber, c]));

  const result: RowResult[] = [];
  const usedInvoices = new Set<string>(); // למנוע ספירה כפולה של חשבונית אותה

  // קודם — ניצול חשבוניות שהוקצו ידנית, כך שלא יוקצו שוב אוטומטית
  for (const a of approvals) usedInvoices.add(a.cardcomInvoiceNumber);

  for (const tx of txRows) {
    const txTime = new Date(tx.txDate).getTime();
    const txName = tx.extractedName ?? "";

    // אישור אדמין — אין חשבונית (החזר/לא מכירה)
    const noInv = noInvoiceByTx.get(tx.id);
    if (noInv) {
      result.push({
        id: tx.id,
        txDate: tx.txDate.toISOString(),
        amount: tx.amount,
        extractedName: tx.extractedName,
        extractedAccount: tx.extractedAccount,
        reference: tx.reference,
        description: tx.description,
        match: null,
        noInvoiceApproval: {
          reason: noInv.reason,
          approvedAt: noInv.approvedAt.toISOString(),
        },
        candidates: [],
      });
      continue;
    }

    // אם יש אישור ידני — מציגים את החשבונית המאושרת ולא מריצים את האלגוריתם
    const approved = approvalByTx.get(tx.id);
    if (approved) {
      const c = cardcomByNumber.get(approved.cardcomInvoiceNumber);
      const cTime = c?.invoiceDate ? new Date(c.invoiceDate).getTime() : txTime;
      const daysDiff = Math.abs(cTime - txTime) / MS_DAY;
      const sim = c ? nameSimilarity(txName, c.customerName ?? "") : 0;
      result.push({
        id: tx.id,
        txDate: tx.txDate.toISOString(),
        amount: tx.amount,
        extractedName: tx.extractedName,
        extractedAccount: tx.extractedAccount,
        reference: tx.reference,
        description: tx.description,
        match: {
          invoiceNumber: approved.cardcomInvoiceNumber,
          invoiceDate: c?.invoiceDate ? c.invoiceDate.toISOString() : new Date(tx.txDate).toISOString(),
          customerName: c?.customerName ?? null,
          customerId: c?.customerId ?? null,
          totalIncludeVat: c?.totalIncludeVat ?? null,
          nameSimilarity: sim,
          daysDiff: Math.round(daysDiff),
          confidence: "high",
          reason: approved.note ? `אושר ידנית — ${approved.note}` : "אושר ידנית",
          approved: true,
          note: approved.note,
        },
        noInvoiceApproval: null,
        candidates: [],
      });
      continue;
    }

    let bestMatch: Match | null = null;
    let bestScore = -1;
    const candidates: RowResult["candidates"] = [];

    for (const c of cardcomRows) {
      if (c.totalIncludeVat == null || c.invoiceDate == null) continue;
      if (usedInvoices.has(c.invoiceNumber)) continue; // כבר תפוסה
      const cTime = new Date(c.invoiceDate).getTime();
      const daysDiff = Math.abs(cTime - txTime) / MS_DAY;

      const amountMatch = amountsEqual(tx.amount, c.totalIncludeVat);
      const sim = nameSimilarity(txName, c.customerName ?? "");
      const inWindow = daysDiff <= windowDays;
      const inExtendedWindow = daysDiff <= windowDays + 7;

      // התאמה אמיתית: סכום מדויק + (שם דומה מאוד או חלון תאריכים)
      if (amountMatch && inWindow && sim >= 0.9) {
        const score = 100 + sim * 10 - daysDiff;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            invoiceNumber: c.invoiceNumber,
            invoiceDate: c.invoiceDate.toISOString(),
            customerName: c.customerName,
            customerId: c.customerId,
            totalIncludeVat: c.totalIncludeVat,
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
            invoiceNumber: c.invoiceNumber,
            invoiceDate: c.invoiceDate.toISOString(),
            customerName: c.customerName,
            customerId: c.customerId,
            totalIncludeVat: c.totalIncludeVat,
            nameSimilarity: sim,
            daysDiff: Math.round(daysDiff),
            confidence: "medium",
            reason: `סכום מדויק + שם ${(sim * 100).toFixed(0)}% + ${Math.round(daysDiff)} ימים`,
          };
        }
      }

      // candidate לבדיקה ידנית: סכום קרוב (±5%) או שם דומה (>0.5) בחלון
      if (!amountMatch || sim < 0.7) {
        const amountDelta = c.totalIncludeVat ? Math.abs(c.totalIncludeVat - tx.amount) / tx.amount : 1;
        if ((amountMatch || amountDelta < 0.05) && (sim > 0.5 || amountMatch) && inExtendedWindow) {
          candidates.push({
            invoiceNumber: c.invoiceNumber,
            invoiceDate: c.invoiceDate.toISOString(),
            customerName: c.customerName,
            customerId: c.customerId,
            totalIncludeVat: c.totalIncludeVat,
            nameSimilarity: sim,
            daysDiff: Math.round(daysDiff),
            reason:
              amountMatch
                ? `סכום מדויק | שם ${(sim * 100).toFixed(0)}% | ${Math.round(daysDiff)} ימים`
                : `סכום קרוב (${c.totalIncludeVat?.toFixed(0)}) | שם ${(sim * 100).toFixed(0)}% | ${Math.round(daysDiff)} ימים`,
          });
        }
      }
    }

    if (bestMatch) usedInvoices.add(bestMatch.invoiceNumber);

    // 3 מועמדים מובילים בלבד למקרה של "ללא"
    candidates.sort((a, b) => b.nameSimilarity - a.nameSimilarity || a.daysDiff - b.daysDiff);

    result.push({
      id: tx.id,
      txDate: tx.txDate.toISOString(),
      amount: tx.amount,
      extractedName: tx.extractedName,
      extractedAccount: tx.extractedAccount,
      reference: tx.reference,
      description: tx.description,
      match: bestMatch,
      noInvoiceApproval: null,
      candidates: bestMatch ? [] : candidates.slice(0, 3),
    });
  }

  const high = result.filter((r) => r.match?.confidence === "high");
  const medium = result.filter((r) => r.match?.confidence === "medium");
  const noInvoice = result.filter((r) => !r.match && r.noInvoiceApproval);
  const unmatched = result.filter((r) => !r.match && !r.noInvoiceApproval);

  const totalAmount = result.reduce((s, r) => s + r.amount, 0);
  const handledAmount = result
    .filter((r) => r.match || r.noInvoiceApproval)
    .reduce((s, r) => s + r.amount, 0);

  return NextResponse.json({
    ok: true,
    rows: result,
    summary: {
      total: result.length,
      high: high.length,
      medium: medium.length,
      noInvoice: noInvoice.length,
      unmatched: unmatched.length,
      totalAmount,
      matchedAmount: handledAmount,
      unmatchedAmount: totalAmount - handledAmount,
    },
    config: { windowDays },
  });
}
