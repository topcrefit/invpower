// קריאה בלבד — משווה קובץ Excel מול ה-DB. לא משנה כלום.
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@libsql/client";
import crypto from "node:crypto";

config({ path: "C:/DEV/INVPOWER/.env.local" });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const file = process.argv[2];
const buf = readFileSync(file);
const wb = XLSX.read(buf, { cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

function findIdx(row, names) {
  return row.findIndex((c) =>
    names.some((n) => String(c ?? "").trim().includes(n))
  );
}
const HEADERS = {
  date: ["תאריך"],
  reference: ["אסמכתא"],
  description: ["תיאור"],
  debit: ["בחובה", "חובה"],
  credit: ["בזכות", "זכות"],
  extended: ["תאור מורחב", "תיאור מורחב"],
};
let headerIdx = -1;
for (let i = 0; i < Math.min(30, rows.length); i++) {
  const r = rows[i];
  if (findIdx(r, HEADERS.date) >= 0 && findIdx(r, HEADERS.reference) >= 0) {
    headerIdx = i;
    break;
  }
}
const idx = {
  date: findIdx(rows[headerIdx], HEADERS.date),
  ref: findIdx(rows[headerIdx], HEADERS.reference),
  desc: findIdx(rows[headerIdx], HEADERS.description),
  debit: findIdx(rows[headerIdx], HEADERS.debit),
  credit: findIdx(rows[headerIdx], HEADERS.credit),
  ext: findIdx(rows[headerIdx], HEADERS.extended),
};

function normalizeRef(ref) {
  if (!ref) return null;
  const t = String(ref).trim();
  if (!t) return null;
  return t.replace(/^699/, "") || t;
}

function parseUSDate(s) {
  // "4/1/26" → 2026-04-01
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  return new Date(year, Number(mm) - 1, Number(dd));
}

function makeDedupKey(parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((p) => p ?? "").join("|"))
    .digest("hex")
    .slice(0, 32);
}

const fileTxs = [];
for (let i = headerIdx + 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r || !r[idx.date]) continue;
  const credit =
    Number(String(r[idx.credit] ?? "").replace(/[,\s₪]/g, "")) || 0;
  if (credit <= 0) continue;
  const date = parseUSDate(r[idx.date]);
  if (!date) continue;
  const ref = String(r[idx.ref] ?? "").trim();
  const refNorm = normalizeRef(ref);
  const ext = String(r[idx.ext] ?? "").trim();
  const desc = String(r[idx.desc] ?? "").trim();
  // התאמה מדויקת ל-bank-excel.ts: [date, normalizedRef, amount-as-number, extended]
  const dedupKey = makeDedupKey([
    date.toISOString().slice(0, 10),
    refNorm,
    credit,
    ext,
  ]);
  fileTxs.push({ date, ref, refNorm, ext, desc, amount: credit, dedupKey });
}

console.log(`=== File total credits: ${fileTxs.length}`);
console.log(`=== File date range: ${fileTxs[0].date.toISOString().slice(0, 10)} → ${fileTxs[fileTxs.length - 1].date.toISOString().slice(0, 10)}`);

// מ-DB: כל תנועות הבנק
const dbRes = await client.execute("SELECT id, tx_date, amount, reference, dedup_key, extracted_name FROM bank_transactions");
const dbRows = dbRes.rows.map((r) => ({
  id: Number(r.id),
  txDate: new Date(Number(r.tx_date) * 1000),
  amount: Number(r.amount),
  reference: String(r.reference ?? ""),
  dedupKey: String(r.dedup_key),
  extractedName: r.extracted_name ? String(r.extracted_name) : null,
}));
console.log(`\n=== DB total bank rows: ${dbRows.length}`);

// סנן רק אפריל מה-DB
const dbApril = dbRows.filter(
  (r) => r.txDate >= new Date(2026, 3, 1) && r.txDate < new Date(2026, 4, 1)
);
console.log(`=== DB April rows: ${dbApril.length}`);

// השווה לפי dedupKey
const dbKeySet = new Set(dbRows.map((r) => r.dedupKey));
const newInFile = fileTxs.filter((t) => !dbKeySet.has(t.dedupKey));
const existInDb = fileTxs.filter((t) => dbKeySet.has(t.dedupKey));
console.log(`\n=== Match by dedupKey:`);
console.log(`    File rows already in DB (same dedupKey): ${existInDb.length}`);
console.log(`    File rows NEW (not in DB): ${newInFile.length}`);

// השווה לפי ref+amount+date (גם לדעת אם היו שינויים)
const dbRefAmtMap = new Map();
for (const r of dbRows) {
  const k = `${r.txDate.toISOString().slice(0, 10)}|${normalizeRef(r.reference)}|${r.amount.toFixed(2)}`;
  if (!dbRefAmtMap.has(k)) dbRefAmtMap.set(k, []);
  dbRefAmtMap.get(k).push(r);
}
let sameRefDifferentDedup = 0;
for (const t of newInFile) {
  const k = `${t.date.toISOString().slice(0, 10)}|${t.refNorm}|${t.amount.toFixed(2)}`;
  if (dbRefAmtMap.has(k)) sameRefDifferentDedup++;
}
console.log(`    Of NEW: same date+ref+amount as something in DB but different dedup: ${sameRefDifferentDedup}`);

// 10 דוגמאות חדשות
console.log("\n=== Sample of NEW rows in file (not in DB):");
for (const t of newInFile.slice(0, 10)) {
  console.log(
    `   ${t.date.toISOString().slice(0, 10)} | ref=${t.ref} | amt=${t.amount} | ${t.ext.slice(0, 60)}`
  );
}

// 10 דוגמאות מה-DB ב-April שלא בקובץ
const fileKeySet = new Set(fileTxs.map((t) => t.dedupKey));
const dbAprilNotInFile = dbApril.filter((r) => !fileKeySet.has(r.dedupKey));
console.log(`\n=== DB April rows NOT in this file: ${dbAprilNotInFile.length}`);
for (const r of dbAprilNotInFile.slice(0, 10)) {
  console.log(
    `   id=${r.id} ${r.txDate.toISOString().slice(0, 10)} | ref=${r.reference} | amt=${r.amount} | name=${r.extractedName ?? "?"}`
  );
}

await client.close();
