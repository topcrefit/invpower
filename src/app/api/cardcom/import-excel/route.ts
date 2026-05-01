import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cardcomInvoices } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { parseCardcomExcel } from "@/lib/parsers/cardcom-excel";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "לא נשלח קובץ" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  let rows;
  try {
    rows = parseCardcomExcel(buf);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה בפרסור הקובץ" },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "לא נמצאו חשבוניות מס/קבלה בהעברה בנקאית בקובץ" }, { status: 400 });
  }

  const values = rows.map((r) => ({
    invoiceNumber: r.invoiceNumber,
    invoiceType: r.invoiceType,
    invoiceDate: r.invoiceDate,
    totalIncludeVat: r.totalIncludeVat,
    totalNoVat: null,
    vatOnly: null,
    customerName: r.customerName,
    customerId: r.customerId,
    email: r.email,
    phone: r.phone,
    asmachta: null,
    rawData: JSON.stringify({ source: "excel-import", ...r }),
  }));

  // Batch upsert בקריאה אחת — מהיר בהרבה מ-N בודדות.
  await db
    .insert(cardcomInvoices)
    .values(values)
    .onConflictDoUpdate({
      target: cardcomInvoices.invoiceNumber,
      set: {
        invoiceType: sql`excluded.invoice_type`,
        invoiceDate: sql`excluded.invoice_date`,
        totalIncludeVat: sql`excluded.total_include_vat`,
        customerName: sql`excluded.customer_name`,
        customerId: sql`excluded.customer_id`,
        email: sql`excluded.email`,
        phone: sql`excluded.phone`,
        rawData: sql`excluded.raw_data`,
        syncedAt: sql`(unixepoch())`,
      },
    });

  const dates = rows.map((r) => r.invoiceDate.getTime());
  const dateFrom = new Date(Math.min(...dates));
  const dateTo = new Date(Math.max(...dates));

  return NextResponse.json({
    ok: true,
    parsed: rows.length,
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
  });
}
