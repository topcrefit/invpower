import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  fireberryPurchases,
  bankFireberryMatches,
} from "@/lib/db/schema";
import { and, gte, lte, asc, inArray } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { nameSimilarity, amountsEqual } from "@/lib/match/name-match";

export const runtime = "nodejs";

/**
 * Phase B — בנק ↔ Fireberry.
 * לכל תנועת בנק: מחפש רכישה ב-Fireberry באותו סכום מדויק + שם דומה.
 * 1:1 בלבד — כל סטייה דורשת טיפול ידני.
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

  const fbBufferMs = (windowDays + 7) * MS_DAY;
  const fbFrom = new Date(from.getTime() - fbBufferMs);
  const fbTo = new Date(to.getTime() + fbBufferMs);

  const [txRows, fbRows] = await Promise.all([
    db
      .select()
      .from(bankTransactions)
      .where(
        and(
          gte(bankTransactions.txDate, from),
          lte(bankTransactions.txDate, to)
        )
      )
      .orderBy(asc(bankTransactions.txDate)),
    db
      .select()
      .from(fireberryPurchases)
      .where(
        and(
          gte(fireberryPurchases.createdOn, fbFrom),
          lte(fireberryPurchases.createdOn, fbTo)
        )
      ),
  ]);

  type Match = {
    purchaseId: number;
    accountProductId: string;
    customerName: string | null;
    productName: string | null;
    price: number | null;
    createdOn: string | null;
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
    candidates: Array<{
      purchaseId: number;
      accountProductId: string;
      customerName: string | null;
      productName: string | null;
      price: number | null;
      createdOn: string | null;
      nameSimilarity: number;
      daysDiff: number;
      reason: string;
    }>;
  };

  const txIds = txRows.map((t) => t.id);
  const approvals =
    txIds.length > 0
      ? await db
          .select()
          .from(bankFireberryMatches)
          .where(inArray(bankFireberryMatches.bankTransactionId, txIds))
      : [];
  const approvalByTx = new Map(approvals.map((a) => [a.bankTransactionId, a]));
  const fbById = new Map(fbRows.map((f) => [f.id, f]));

  const result: RowResult[] = [];
  const usedFb = new Set<number>();
  for (const a of approvals) usedFb.add(a.fireberryPurchaseId);

  for (const tx of txRows) {
    const txTime = new Date(tx.txDate).getTime();
    const txName = tx.extractedName ?? "";

    const approved = approvalByTx.get(tx.id);
    if (approved) {
      const fb = fbById.get(approved.fireberryPurchaseId);
      const cTime = fb?.createdOn ? new Date(fb.createdOn).getTime() : txTime;
      const daysDiff = Math.abs(cTime - txTime) / MS_DAY;
      const sim = fb ? nameSimilarity(txName, fb.customerName ?? "") : 0;
      result.push({
        id: tx.id,
        txDate: tx.txDate.toISOString(),
        amount: tx.amount,
        extractedName: tx.extractedName,
        extractedAccount: tx.extractedAccount,
        reference: tx.reference,
        description: tx.description,
        match: {
          purchaseId: approved.fireberryPurchaseId,
          accountProductId: fb?.accountProductId ?? "",
          customerName: fb?.customerName ?? null,
          productName: fb?.productName ?? null,
          price: fb?.price ?? null,
          createdOn: fb?.createdOn ? fb.createdOn.toISOString() : null,
          nameSimilarity: sim,
          daysDiff: Math.round(daysDiff),
          confidence: "high",
          reason: approved.note
            ? `אושר ידנית — ${approved.note}`
            : "אושר ידנית",
          approved: true,
          note: approved.note,
        },
        candidates: [],
      });
      continue;
    }

    let bestMatch: Match | null = null;
    let bestScore = -1;
    const candidates: RowResult["candidates"] = [];

    for (const fb of fbRows) {
      if (fb.price == null || fb.createdOn == null) continue;
      if (usedFb.has(fb.id)) continue;
      const cTime = new Date(fb.createdOn).getTime();
      const daysDiff = Math.abs(cTime - txTime) / MS_DAY;

      const amountMatch = amountsEqual(tx.amount, fb.price);
      const sim = nameSimilarity(txName, fb.customerName ?? "");
      const inWindow = daysDiff <= windowDays;
      const inExtendedWindow = daysDiff <= windowDays + 7;

      if (amountMatch && inWindow && sim >= 0.9) {
        const score = 100 + sim * 10 - daysDiff;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            purchaseId: fb.id,
            accountProductId: fb.accountProductId,
            customerName: fb.customerName,
            productName: fb.productName,
            price: fb.price,
            createdOn: fb.createdOn.toISOString(),
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
            purchaseId: fb.id,
            accountProductId: fb.accountProductId,
            customerName: fb.customerName,
            productName: fb.productName,
            price: fb.price,
            createdOn: fb.createdOn.toISOString(),
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
            ? Math.abs(fb.price - tx.amount) / tx.amount
            : 1;
        if (
          (amountMatch || amountDelta < 0.05) &&
          (sim > 0.5 || amountMatch) &&
          inExtendedWindow
        ) {
          candidates.push({
            purchaseId: fb.id,
            accountProductId: fb.accountProductId,
            customerName: fb.customerName,
            productName: fb.productName,
            price: fb.price,
            createdOn: fb.createdOn.toISOString(),
            nameSimilarity: sim,
            daysDiff: Math.round(daysDiff),
            reason: amountMatch
              ? `סכום מדויק | שם ${(sim * 100).toFixed(0)}% | ${Math.round(daysDiff)} ימים`
              : `סכום קרוב (${fb.price?.toFixed(0)}) | שם ${(sim * 100).toFixed(0)}% | ${Math.round(daysDiff)} ימים`,
          });
        }
      }
    }

    if (bestMatch) usedFb.add(bestMatch.purchaseId);
    candidates.sort(
      (a, b) => b.nameSimilarity - a.nameSimilarity || a.daysDiff - b.daysDiff
    );

    result.push({
      id: tx.id,
      txDate: tx.txDate.toISOString(),
      amount: tx.amount,
      extractedName: tx.extractedName,
      extractedAccount: tx.extractedAccount,
      reference: tx.reference,
      description: tx.description,
      match: bestMatch,
      candidates: bestMatch ? [] : candidates.slice(0, 3),
    });
  }

  const high = result.filter((r) => r.match?.confidence === "high");
  const medium = result.filter((r) => r.match?.confidence === "medium");
  const unmatched = result.filter((r) => !r.match);

  const totalAmount = result.reduce((s, r) => s + r.amount, 0);
  const matchedAmount = result
    .filter((r) => r.match)
    .reduce((s, r) => s + r.amount, 0);

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
