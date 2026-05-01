// קריאה בלבד — לא שומר לכלום, רק מציג מה יש בקובץ
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node inspect-bank-excel.mjs <path>");
  process.exit(1);
}

const buf = readFileSync(file);
const wb = XLSX.read(buf, { cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

console.log("=== Sheet name:", wb.SheetNames[0]);
console.log("=== Total rows in sheet:", rows.length);

// הצג 30 שורות ראשונות גולמי
console.log("\n=== First 30 rows (raw):");
for (let i = 0; i < Math.min(30, rows.length); i++) {
  console.log(i, JSON.stringify(rows[i]));
}

// חפש שורת כותרות
const HEADERS = {
  date: ["תאריך"],
  reference: ["אסמכתא"],
  description: ["תיאור"],
  debit: ["בחובה", "חובה"],
  credit: ["בזכות", "זכות"],
  extended: ["תאור מורחב", "תיאור מורחב"],
};
function find(row, names) {
  return row.findIndex((c) =>
    names.some((n) => String(c ?? "").trim().includes(n))
  );
}
let headerIdx = -1;
for (let i = 0; i < Math.min(30, rows.length); i++) {
  const r = rows[i];
  if (find(r, HEADERS.date) >= 0 && find(r, HEADERS.reference) >= 0) {
    headerIdx = i;
    break;
  }
}
console.log("\n=== Header row index:", headerIdx);
if (headerIdx < 0) process.exit(0);
console.log("Header row:", JSON.stringify(rows[headerIdx]));

const idx = {
  date: find(rows[headerIdx], HEADERS.date),
  ref: find(rows[headerIdx], HEADERS.reference),
  desc: find(rows[headerIdx], HEADERS.description),
  debit: find(rows[headerIdx], HEADERS.debit),
  credit: find(rows[headerIdx], HEADERS.credit),
  ext: find(rows[headerIdx], HEADERS.extended),
};
console.log("Column indexes:", idx);

// פרסר תנועות
let dataCount = 0;
const txs = [];
for (let i = headerIdx + 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.length === 0) continue;
  const dateVal = r[idx.date];
  if (!dateVal) continue;
  const debit = Number(String(r[idx.debit] ?? "").replace(/[,\s₪]/g, "")) || 0;
  const credit = Number(String(r[idx.credit] ?? "").replace(/[,\s₪]/g, "")) || 0;
  // נקח רק זכות (כניסות כסף) — חיוב הוא תשלום שלנו
  if (credit <= 0) continue;
  txs.push({
    date: dateVal,
    ref: String(r[idx.ref] ?? "").trim(),
    desc: String(r[idx.desc] ?? "").trim(),
    amount: credit,
    ext: String(r[idx.ext] ?? "").trim(),
  });
  dataCount++;
}

console.log(`\n=== Total CREDIT (incoming) transactions: ${dataCount}`);
console.log("\n=== First 10 incoming transactions:");
for (const t of txs.slice(0, 10)) {
  console.log(JSON.stringify(t));
}

// טווח תאריכים
const dates = txs.map((t) => t.date).filter((d) => d);
console.log(`\n=== Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

// סכום כולל
const total = txs.reduce((s, t) => s + t.amount, 0);
console.log(`=== Total credit amount: ${total.toFixed(2)}`);

// אסמכתאות עם 699 prefix
const with699 = txs.filter((t) => /^699/.test(t.ref));
console.log(`=== Refs starting with "699": ${with699.length}`);
