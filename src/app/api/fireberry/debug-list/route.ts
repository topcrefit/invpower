import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { fireberryPurchases } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * דיבוג: רשימת כל הרכישות שסונכרנו מ-Fireberry, עם השדות הרלוונטיים
 * לבדיקת 4 הכללים — תאריך יצירה, סטטוס חשבונית, סוג תשלום, מחיר.
 */
export async function GET() {
  const session = await getSession();
  if (!session.userId)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(fireberryPurchases)
    .orderBy(asc(fireberryPurchases.createdOn));

  const FEB1 = Date.UTC(2026, 1, 1);

  const items = rows.map((r) => {
    const createdMs = r.createdOn ? r.createdOn.getTime() : NaN;
    return {
      accountProductId: r.accountProductId,
      customerName: r.customerName,
      price: r.price,
      createdOn: r.createdOn?.toISOString() ?? null,
      invoiceStatus: r.invoiceStatusName,
      paymentType: r.paymentTypeName,
      checks: {
        rule1_after_feb1: Number.isFinite(createdMs) && createdMs > FEB1,
        rule2_status_not_sent: r.invoiceStatusName === "לא נשלח",
        rule3_price_gt_0_9: r.price != null && r.price > 0.9,
        rule4_payment_bank_transfer: r.paymentTypeName === "העברה בנקאית",
      },
    };
  });

  return NextResponse.json({ count: items.length, items });
}
