import { db } from "@/lib/db/client";
import { cardcomInvoices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cardcomGetReport } from "./client";

/**
 * סנכרון חשבוניות Cardcom מ-GetReport אל המטמון המקומי.
 * שדות לפי תשובת ה-API בפועל:
 *   Invoice_Number, InvoiceType, InvoiceDate / InvoiceDateOnly,
 *   Cust_Name, Comp_ID, Email, Cust_LinePH / Cust_MobilePH,
 *   TotalIncludeVATNIS, TotalNoVatNIS, VATOnlyNIS,
 *   Asmachta, IsOpen
 */
export async function syncCardcomInvoices(from: Date, to: Date) {
  const list = await cardcomGetReport(from, to, 1);
  let created = 0;
  let updated = 0;

  for (const item of list) {
    const invNum = String(
      item.Invoice_Number ?? item.InvoiceNumber ?? item.invoiceNumber ?? ""
    );
    if (!invNum || invNum === "0") continue;

    const invType = Number(item.InvoiceType ?? item.invoiceType ?? 1);
    const dateStr = String(
      item.InvoiceDateOnly ?? item.InvoiceDate ?? item.invoiceDate ?? ""
    );
    const invoiceDate = dateStr ? new Date(dateStr) : null;

    const totalIncludeVat = numOrNull(
      item.TotalIncludeVATNIS ?? item.TotalIncludeVAT ?? item.totalIncludeVat
    );
    const totalNoVat = numOrNull(
      item.TotalNoVatNIS ?? item.TotalNoVAT ?? item.totalNoVat
    );
    const vatOnly = numOrNull(item.VATOnlyNIS ?? item.VATOnly ?? item.vatOnly);

    const customerName = strOrNull(item.Cust_Name ?? item.CustName);
    const customerId = strOrNull(
      typeof item.Comp_ID === "string"
        ? (item.Comp_ID as string).trim()
        : item.Comp_ID
    );
    const email = strOrNull(item.Email ?? item.email);
    const phone = strOrNull(
      item.Cust_MobilePH ?? item.Cust_LinePH ?? item.Phone ?? item.phone
    );
    const asmachta = strOrNull(item.Asmachta ?? item.asmachta);

    const existing = await db
      .select()
      .from(cardcomInvoices)
      .where(eq(cardcomInvoices.invoiceNumber, invNum));

    if (existing.length === 0) {
      await db.insert(cardcomInvoices).values({
        invoiceNumber: invNum,
        invoiceType: invType,
        invoiceDate,
        totalIncludeVat,
        totalNoVat,
        vatOnly,
        customerName,
        customerId,
        email,
        phone,
        asmachta,
        rawData: JSON.stringify(item),
      });
      created++;
    } else {
      await db
        .update(cardcomInvoices)
        .set({
          invoiceType: invType,
          invoiceDate,
          totalIncludeVat,
          totalNoVat,
          vatOnly,
          customerName,
          customerId,
          email,
          phone,
          asmachta,
          rawData: JSON.stringify(item),
          syncedAt: new Date(),
        })
        .where(eq(cardcomInvoices.invoiceNumber, invNum));
      updated++;
    }
  }

  return { created, updated, total: list.length };
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function strOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}
