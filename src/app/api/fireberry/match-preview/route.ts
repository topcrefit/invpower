import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { cardcomInvoices, fireberryPurchases } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { nameSimilarity, amountsEqual } from "@/lib/match/name-match";

export const runtime = "nodejs";

export type FireberryMatchRow = {
  purchaseId: number;
  accountProductId: string;
  customerName: string | null;
  customerTaxId: string | null;
  productName: string | null;
  price: number | null;
  bestMatch: {
    invoiceNumber: string;
    invoiceDate: string | null;
    customerName: string | null;
    customerId: string | null;
    totalIncludeVat: number | null;
    nameSimilarity: number;
    taxIdMatch: boolean;
    amountMatch: boolean;
    confidence: "high" | "medium" | "low";
    reason: string;
  } | null;
};

function normalizeTaxId(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [purchases, invoices] = await Promise.all([
    db.select().from(fireberryPurchases),
    db.select().from(cardcomInvoices),
  ]);

  const result: FireberryMatchRow[] = [];

  for (const fb of purchases) {
    const fbTax = normalizeTaxId(fb.customerTaxId);
    const fbName = fb.customerName ?? "";
    const fbPrice = fb.price;

    let best: FireberryMatchRow["bestMatch"] = null;
    let bestScore = -1;

    for (const c of invoices) {
      const cTax = normalizeTaxId(c.customerId);
      const cName = c.customerName ?? "";
      const cAmount = c.totalIncludeVat;

      const taxIdMatch = !!fbTax && !!cTax && fbTax === cTax;
      const amountMatch = fbPrice != null && cAmount != null && amountsEqual(fbPrice, cAmount);
      const sim = nameSimilarity(fbName, cName);

      // חוקים מחמירים: התאמה אמיתית דורשת ת.ז. תואם או שם דומה מאוד.
      // סכום מדויק לבד == רעש (יש המון חשבוניות באותו סכום).
      let confidence: "high" | "medium" | "low" | null = null;
      let reason = "";
      if (taxIdMatch && amountMatch) {
        confidence = "high";
        reason = `ת.ז. תואם + סכום מדויק`;
      } else if (amountMatch && sim >= 0.95) {
        confidence = "high";
        reason = `שם זהה (${(sim * 100).toFixed(0)}%) + סכום מדויק`;
      } else if (amountMatch && sim >= 0.8) {
        confidence = "medium";
        reason = `שם דומה (${(sim * 100).toFixed(0)}%) + סכום מדויק`;
      } else if (taxIdMatch) {
        confidence = "medium";
        reason = `ת.ז. תואם (סכום שונה)`;
      } else {
        continue; // לא התאמה — לא מציעים
      }

      const score = (confidence === "high" ? 100 : 50) + sim * 10;
      if (score > bestScore) {
        bestScore = score;
        best = {
          invoiceNumber: c.invoiceNumber,
          invoiceDate: c.invoiceDate ? c.invoiceDate.toISOString() : null,
          customerName: c.customerName,
          customerId: c.customerId,
          totalIncludeVat: c.totalIncludeVat,
          nameSimilarity: sim,
          taxIdMatch,
          amountMatch,
          confidence,
          reason,
        };
      }
    }

    result.push({
      purchaseId: fb.id,
      accountProductId: fb.accountProductId,
      customerName: fb.customerName,
      customerTaxId: fb.customerTaxId,
      productName: fb.productName,
      price: fb.price,
      bestMatch: best,
    });
  }

  // מיון: high → medium → ללא match
  const order = { high: 0, medium: 1, low: 2 } as const;
  result.sort((a, b) => {
    const ra = a.bestMatch ? order[a.bestMatch.confidence] : 9;
    const rb = b.bestMatch ? order[b.bestMatch.confidence] : 9;
    return ra - rb;
  });

  return NextResponse.json({
    ok: true,
    rows: result,
    summary: {
      total: result.length,
      high: result.filter((r) => r.bestMatch?.confidence === "high").length,
      medium: result.filter((r) => r.bestMatch?.confidence === "medium").length,
      noMatch: result.filter((r) => !r.bestMatch).length,
    },
  });
}
