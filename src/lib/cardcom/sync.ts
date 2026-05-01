import { db } from "@/lib/db/client";
import { cardcomInvoices } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
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

  type Row = typeof cardcomInvoices.$inferInsert;
  const rows: Row[] = [];
  for (const item of list) {
    const invNum = String(
      item.Invoice_Number ?? item.InvoiceNumber ?? item.invoiceNumber ?? ""
    );
    if (!invNum || invNum === "0") continue;
    const invType = Number(item.InvoiceType ?? item.invoiceType ?? 1);
    const dateStr = String(
      item.InvoiceDateOnly ?? item.InvoiceDate ?? item.invoiceDate ?? ""
    );
    rows.push({
      invoiceNumber: invNum,
      invoiceType: invType,
      invoiceDate: dateStr ? new Date(dateStr) : null,
      totalIncludeVat: numOrNull(
        item.TotalIncludeVATNIS ?? item.TotalIncludeVAT ?? item.totalIncludeVat
      ),
      totalNoVat: numOrNull(
        item.TotalNoVatNIS ?? item.TotalNoVAT ?? item.totalNoVat
      ),
      vatOnly: numOrNull(item.VATOnlyNIS ?? item.VATOnly ?? item.vatOnly),
      customerName: strOrNull(item.Cust_Name ?? item.CustName),
      customerId: strOrNull(
        typeof item.Comp_ID === "string"
          ? (item.Comp_ID as string).trim()
          : item.Comp_ID
      ),
      email: strOrNull(item.Email ?? item.email),
      phone: strOrNull(
        item.Cust_MobilePH ?? item.Cust_LinePH ?? item.Phone ?? item.phone
      ),
      asmachta: strOrNull(item.Asmachta ?? item.asmachta),
      rawData: JSON.stringify(item),
    });
  }

  // upsert ב-batch של 100
  let upserted = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const result = await db
      .insert(cardcomInvoices)
      .values(batch)
      .onConflictDoUpdate({
        target: cardcomInvoices.invoiceNumber,
        set: {
          invoiceType: sql`excluded.invoice_type`,
          invoiceDate: sql`excluded.invoice_date`,
          totalIncludeVat: sql`excluded.total_include_vat`,
          totalNoVat: sql`excluded.total_no_vat`,
          vatOnly: sql`excluded.vat_only`,
          customerName: sql`excluded.customer_name`,
          customerId: sql`excluded.customer_id`,
          email: sql`excluded.email`,
          phone: sql`excluded.phone`,
          asmachta: sql`excluded.asmachta`,
          rawData: sql`excluded.raw_data`,
          syncedAt: sql`(unixepoch())`,
        },
      })
      .returning({ id: cardcomInvoices.id });
    upserted += result.length;
  }

  return { created: upserted, updated: 0, total: list.length };
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
