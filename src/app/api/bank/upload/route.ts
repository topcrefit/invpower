import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { bankUploads, bankTransactions } from "@/lib/db/schema";
import { parseBankExcel, fileSha256 } from "@/lib/parsers/bank-excel";
import { getSession } from "@/lib/auth/session";
import { eq, sql } from "drizzle-orm";

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
  const hash = fileSha256(buf);

  // Check duplicate file
  const existing = await db
    .select()
    .from(bankUploads)
    .where(eq(bankUploads.fileHash, hash));
  if (existing.length > 0) {
    return NextResponse.json({
      ok: true,
      duplicate: true,
      uploadId: existing[0].id,
      message: "הקובץ הזה כבר הועלה בעבר",
    });
  }

  let rows;
  try {
    rows = parseBankExcel(buf);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה בפרסור הקובץ" },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "לא נמצאו תנועות זכות בקובץ" }, { status: 400 });
  }

  const dates = rows.map((r) => r.txDate.getTime());
  const dateFrom = new Date(Math.min(...dates));
  const dateTo = new Date(Math.max(...dates));

  const [upload] = await db
    .insert(bankUploads)
    .values({
      userId: session.userId,
      fileName: file.name,
      fileHash: hash,
      rowCount: rows.length,
      dateFrom,
      dateTo,
    })
    .returning();

  // Upsert לפי dedupKey: אם תנועה זהה כבר קיימת (למשל אותה אסמכתא בלי prefix "699"),
  // נדרוס את המקור עם הערכים החדשים — שומר את אותו ID כך שאישורים והתאמות שורדים.
  const result = await db
    .insert(bankTransactions)
    .values(
      rows.map((r) => ({
        uploadId: upload.id,
        txDate: r.txDate,
        valueDate: r.valueDate,
        description: r.description,
        reference: r.reference,
        amount: r.amount,
        extendedDescription: r.extendedDescription,
        note: r.note,
        extractedName: r.extractedName,
        extractedAccount: r.extractedAccount,
        dedupKey: r.dedupKey,
      }))
    )
    .onConflictDoUpdate({
      target: bankTransactions.dedupKey,
      set: {
        reference: sql`excluded.reference`,
        description: sql`excluded.description`,
        extendedDescription: sql`excluded.extended_description`,
        extractedName: sql`excluded.extracted_name`,
        extractedAccount: sql`excluded.extracted_account`,
        valueDate: sql`excluded.value_date`,
        note: sql`excluded.note`,
      },
    })
    .returning({ id: bankTransactions.id });

  const inserted = result.length;
  const skipped = rows.length - inserted;

  return NextResponse.json({
    ok: true,
    uploadId: upload.id,
    rowsParsed: rows.length,
    inserted,
    skipped,
    dateFrom: dateFrom.toISOString(),
    dateTo: dateTo.toISOString(),
  });
}
