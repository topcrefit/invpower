import { db } from "@/lib/db/client";
import { fireberryPurchases } from "@/lib/db/schema";
import { sql, notInArray, inArray } from "drizzle-orm";
import {
  fireberryFetchPurchases,
  fireberryEnrichWithAccount,
  pickPrice,
  pickPhone,
} from "./client";

/**
 * מרענן את כל הרכישות מ-Fireberry — רק "לא נשלח + העברה בנקאית".
 * upsert לפי accountProductId — שומר IDs קיימים כדי לא לשבור FK
 * (issued_invoices, bank_fireberry_matches מצביעים אליהם).
 */
export async function syncFireberryPurchases() {
  const raw = await fireberryFetchPurchases();
  const enriched = await fireberryEnrichWithAccount(raw);

  const rows = enriched
    .map((r) => {
      const apId = String(r.accountproductid ?? "");
      if (!apId) return null;
      return {
        accountProductId: apId,
        accountId: r.accountid ?? null,
        productName: r.productname ?? null,
        invoiceLinesDescription:
          (r.pcfsystemfield195 as string | null | undefined) ??
          (r.pcfInvoiceLinesDescription as string | null | undefined) ??
          (r.pcfinvoicelinesdescription as string | null | undefined) ??
          null,
        price: pickPrice(r),
        customerName: r.accountname ?? null,
        customerTaxId: r.idnumber ?? null,
        customerPhone: pickPhone(r),
        customerEmail: (r.emailaddress1 as string | null) ?? null,
        paymentTypeName: r.pcfsystemfield73name ?? null,
        invoiceStatusName: r.pcfsystemfield147name ?? null,
        createdOn: r.createdon ? new Date(String(r.createdon)) : null,
        modifiedOn: r.modifiedon ? new Date(String(r.modifiedon)) : null,
        rawJson: JSON.stringify(r),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // upsert ב-batch של 100 בכל פעם — מהיר משמעותית ושומר id קיים
  let upserted = 0;
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const result = await db
      .insert(fireberryPurchases)
      .values(batch)
      .onConflictDoUpdate({
        target: fireberryPurchases.accountProductId,
        set: {
          accountId: sql`excluded.account_id`,
          productName: sql`excluded.product_name`,
          invoiceLinesDescription: sql`excluded.invoice_lines_description`,
          price: sql`excluded.price`,
          customerName: sql`excluded.customer_name`,
          customerTaxId: sql`excluded.customer_tax_id`,
          customerPhone: sql`excluded.customer_phone`,
          customerEmail: sql`excluded.customer_email`,
          paymentTypeName: sql`excluded.payment_type_name`,
          invoiceStatusName: sql`excluded.invoice_status_name`,
          createdOn: sql`excluded.created_on`,
          modifiedOn: sql`excluded.modified_on`,
          rawJson: sql`excluded.raw_json`,
          syncedAt: sql`(unixepoch())`,
        },
      })
      .returning({ id: fireberryPurchases.id });
    upserted += result.length;
  }

  // מחיקת רשומות שלא קיימות יותר ב-Fireberry (סטטוס השתנה ל"נשלח")
  // אבל רק אלה שלא מקושרות ל-issued_invoices (כדי לא לשבור FK)
  const currentApIds = rows.map((r) => r.accountProductId);
  let removed = 0;
  if (currentApIds.length > 0) {
    // שלוף את הרשומות שלא ברשימה החדשה
    const stale = await db
      .select({
        id: fireberryPurchases.id,
        accountProductId: fireberryPurchases.accountProductId,
      })
      .from(fireberryPurchases)
      .where(notInArray(fireberryPurchases.accountProductId, currentApIds));

    if (stale.length > 0) {
      // מחק רק את אלו שלא מקושרים ל-issued_invoices
      // (פשוט יותר: ננסה למחוק כל אחד; אם FK חוסם, נדלג)
      for (const s of stale) {
        try {
          await db
            .delete(fireberryPurchases)
            .where(inArray(fireberryPurchases.id, [s.id]));
          removed++;
        } catch {
          // FK חסם — הרשומה מקושרת לחשבונית שהופקה. שומרים אותה.
        }
      }
    }
  }

  return { created: upserted, updated: 0, removed, total: rows.length };
}
