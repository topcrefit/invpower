import { db } from "@/lib/db/client";
import { cardcomInvoices } from "@/lib/db/schema";
import { and, gte, lte } from "drizzle-orm";
import { nameSimilarity, amountsEqual } from "@/lib/match/name-match";

/**
 * בדיקה האם כבר קיימת חשבונית מס/קבלה ב-Cardcom (מטמון מקומי) — לפי סכום + שם דומה.
 */
export async function findExistingCardcomInvoice(
  amount: number,
  name: string | null,
  date: Date
): Promise<{ invoiceNumber: string; reason: string } | null> {
  const dayMs = 86400 * 1000;
  const min = new Date(date.getTime() - dayMs * 2);
  const max = new Date(date.getTime() + dayMs * 2);

  const rows = await db
    .select()
    .from(cardcomInvoices)
    .where(
      and(
        gte(cardcomInvoices.invoiceDate, min),
        lte(cardcomInvoices.invoiceDate, max)
      )
    );

  for (const r of rows) {
    if (r.totalIncludeVat == null) continue;
    if (!amountsEqual(amount, r.totalIncludeVat)) continue;
    const sim = nameSimilarity(name ?? "", r.customerName ?? "");
    if (!name) {
      return { invoiceNumber: r.invoiceNumber, reason: `סכום זהה (${amount}) ותאריך תואם` };
    }
    if (sim >= 0.6) {
      return {
        invoiceNumber: r.invoiceNumber,
        reason: `סכום זהה + שם דומה (${(sim * 100).toFixed(0)}%) ל-${r.customerName ?? "?"}`,
      };
    }
  }
  return null;
}
