import * as XLSX from "xlsx";
import crypto from "node:crypto";

export type ParsedBankRow = {
  txDate: Date;
  valueDate: Date | null;
  description: string | null;
  reference: string | null;
  amount: number;
  extendedDescription: string | null;
  note: string | null;
  extractedName: string | null;
  extractedAccount: string | null;
  dedupKey: string;
};

const HEADERS = {
  date: ["תאריך"],
  valueDate: ["תאריך ערך"],
  description: ["תיאור"],
  reference: ["אסמכתא"],
  debit: ["בחובה", "חובה"],
  credit: ["בזכות", "זכות"],
  extended: ["תאור מורחב", "תיאור מורחב"],
  note: ["הערה"],
};

function findIdx(row: unknown[], names: string[]): number {
  return row.findIndex((c) =>
    names.some((n) => String(c ?? "").trim().includes(n))
  );
}

/**
 * שליפת שם מפקיד וחשבון מתוך התיאור המורחב.
 * דוגמה: "העברה מאת: סבג אוה מרסלה 09-001-026667846"
 */
export function extractFromExtended(text: string | null | undefined): {
  name: string | null;
  account: string | null;
} {
  if (!text) return { name: null, account: null };
  const accountMatch = text.match(/(\d{1,3}-\d{1,3}-\d{4,12})/);
  const account = accountMatch ? accountMatch[1] : null;

  let name: string | null = null;
  const m = text.match(/העברה\s+מאת:?\s*(.+?)(?=\s+\d{1,3}-\d{1,3}-\d{4,12}|$)/);
  if (m) name = m[1].trim();
  return { name, account };
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date
    const utcDays = Math.floor(v - 25569);
    return new Date(utcDays * 86400 * 1000);
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[,\s₪]/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function makeDedupKey(parts: (string | number | null)[]): string {
  return crypto
    .createHash("sha256")
    .update(parts.map((p) => (p ?? "")).join("|"))
    .digest("hex")
    .slice(0, 32);
}

export function parseBankExcel(buf: Buffer): ParsedBankRow[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("הקובץ ריק או לא תקין");
  const ws = wb.Sheets[sheetName];

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
  });

  if (aoa.length < 2) return [];

  // מאתרים שורת כותרת (אמורה להיות שורה 1, אבל לפעמים יש שורות עליונות)
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(5, aoa.length); i++) {
    const row = aoa[i];
    if (
      row &&
      findIdx(row, HEADERS.date) !== -1 &&
      findIdx(row, HEADERS.credit) !== -1
    ) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error('לא נמצאה שורת כותרת תקינה (חסר "תאריך" או "בזכות")');
  }

  const header = aoa[headerRowIdx];
  const idx = {
    date: findIdx(header, HEADERS.date),
    valueDate: findIdx(header, HEADERS.valueDate),
    description: findIdx(header, HEADERS.description),
    reference: findIdx(header, HEADERS.reference),
    debit: findIdx(header, HEADERS.debit),
    credit: findIdx(header, HEADERS.credit),
    extended: findIdx(header, HEADERS.extended),
    note: findIdx(header, HEADERS.note),
  };

  const rows: ParsedBankRow[] = [];
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.every((c) => c === null || c === "")) continue;

    const credit = toNumber(row[idx.credit]);
    if (credit <= 0) continue; // רק הפקדות

    const txDate = toDate(row[idx.date]);
    if (!txDate) continue;

    const reference =
      row[idx.reference] != null ? String(row[idx.reference]).trim() : null;
    const description =
      row[idx.description] != null ? String(row[idx.description]).trim() : null;
    const extended =
      row[idx.extended] != null ? String(row[idx.extended]).trim() : null;
    const note =
      idx.note >= 0 && row[idx.note] != null
        ? String(row[idx.note]).trim()
        : null;

    const { name, account } = extractFromExtended(extended);

    rows.push({
      txDate,
      valueDate: toDate(row[idx.valueDate]),
      description,
      reference,
      amount: credit,
      extendedDescription: extended,
      note,
      extractedName: name,
      extractedAccount: account,
      dedupKey: makeDedupKey([
        txDate.toISOString().slice(0, 10),
        reference,
        credit,
        extended,
      ]),
    });
  }
  return rows;
}

export function fileSha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
