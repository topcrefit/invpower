import * as XLSX from "xlsx";

/**
 * פרסור קובץ "מסמכים" שמיוצא מ-Cardcom.
 * עמודות בקובץ:
 *   A תאריך | B שעה | C מס מסמך | D סוג | E סה"כ חשבונית |
 *   F סה"כ קבלה | G העברה בנקאית | H ת.ז./ח.פ. | I שם לקוח | J טלפון | K אימייל
 *
 * הפרסור מסנן רק "חשבונית מס קבלה" — לא משנה אמצעי תשלום
 * (אשראי / מזומן / העברה — הכל נכנס, כדי לזהות חוסר סינכרון מול Fireberry).
 */

export type ParsedCardcomRow = {
  invoiceNumber: string;
  invoiceDate: Date;
  invoiceType: number; // 1 = חשבונית מס קבלה
  totalIncludeVat: number;
  bankTransferAmount: number | null; // null = לא הופק כהעברה בנקאית
  customerName: string | null;
  customerId: string | null;
  phone: string | null;
  email: string | null;
};

function excelSerialToDate(s: number): Date {
  // Excel serial → JS Date (UTC noon to avoid TZ flip)
  const ms = Math.round((s - 25569) * 86400 * 1000);
  return new Date(ms);
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseCardcomExcel(buf: Buffer): ParsedCardcomRow[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sh, { defval: null });

  const out: ParsedCardcomRow[] = [];
  for (const r of rows) {
    const type = strOrNull(r["__EMPTY_2"]);
    if (type !== "חשבונית מס קבלה") continue;

    const dateSerial = r["פרטי מסמך"];
    if (typeof dateSerial !== "number") continue;
    const invoiceDate = excelSerialToDate(dateSerial);

    const invoiceNumber = strOrNull(r["__EMPTY_1"]);
    if (!invoiceNumber) continue;

    const bankTransferAmount = numOrNull(r["__EMPTY_4"]);
    const totalIncludeVat = numOrNull(r["שקל"]);
    if (totalIncludeVat == null) continue;

    out.push({
      invoiceNumber,
      invoiceDate,
      invoiceType: 1,
      totalIncludeVat,
      bankTransferAmount: bankTransferAmount && bankTransferAmount > 0 ? bankTransferAmount : null,
      customerName: strOrNull(r["__EMPTY_5"]),
      customerId: strOrNull(r["פרטי לקוח"]),
      phone: strOrNull(r["__EMPTY_6"]),
      email: strOrNull(r["__EMPTY_7"]),
    });
  }
  return out;
}
