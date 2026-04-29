import { db } from "@/lib/db/client";
import { fireberryPurchases } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  fireberryFetchPurchases,
  fireberryEnrichWithAccount,
  pickPrice,
  pickPhone,
} from "./client";

/**
 * שולף את כל הרכישות מ-Fireberry בטווח תאריכים, מעשיר מ-Account, ושומר ב-Turso.
 */
export async function syncFireberryPurchases(from: Date, to: Date) {
  const raw = await fireberryFetchPurchases({ from, to });
  const enriched = await fireberryEnrichWithAccount(raw);

  let created = 0;
  let updated = 0;

  for (const r of enriched) {
    const apId = String(r.accountproductid ?? "");
    if (!apId) continue;

    const data = {
      accountProductId: apId,
      accountId: r.accountid ?? null,
      productName: r.productname ?? null,
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

    const existing = await db
      .select()
      .from(fireberryPurchases)
      .where(eq(fireberryPurchases.accountProductId, apId));

    if (existing.length === 0) {
      await db.insert(fireberryPurchases).values(data);
      created++;
    } else {
      await db
        .update(fireberryPurchases)
        .set({ ...data, syncedAt: new Date() })
        .where(eq(fireberryPurchases.accountProductId, apId));
      updated++;
    }
  }
  return { created, updated, total: enriched.length };
}
