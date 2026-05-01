// העלאת קובץ אקסל ישירות ל-DB — מימוש זהה לחלוטין ל-/api/bank/upload.
// משתמש ב-onConflictDoUpdate על dedupKey: שומר id ואישורים, מעדכן שדות.
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
const fileName = process.argv[3] || "אפריל 3004.xlsx";
const userId = Number(process.argv[4] || 1); // session.userId
if (!file) {
  console.error("Usage: node upload-bank-file.mjs <path> <fileName> <userId>");
  process.exit(1);
}

const buf = readFileSync(file);
const fileHash = crypto.createHash("sha256").update(buf).digest("hex");

// בדיקת כפילות קובץ
const dupCheck = await client.execute({
  sql: "SELECT id FROM bank_uploads WHERE file_hash = ?",
  args: [fileHash],
});
if (dupCheck.rows.length > 0) {
  console.log(`⚠️  קובץ זהה כבר הועלה (uploadId=${dupCheck.rows[0].id}). יוצא.`);
  await client.close();
  process.exit(0);
}

// פרסור
const wb = XLSX.read(buf, { cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

const HEADERS = {
  date: ["תאריך"],
  valueDate: ["תאריך ערך"],
  reference: ["אסמכתא"],
  description: ["תיאור"],
  debit: ["בחובה", "חובה"],
  credit: ["בזכות", "זכות"],
  extended: ["תאור מורחב", "תיאור מורחב"],
  note: ["הערה"],
};
function findIdx(row, names) {
  return row.findIndex((c) =>
    names.some((n) => String(c ?? "").trim().includes(n))
  );
}

let headerIdx = -1;
for (let i = 0; i < Math.min(5, aoa.length); i++) {
  const r = aoa[i];
  if (r && findIdx(r, HEADERS.date) !== -1 && findIdx(r, HEADERS.credit) !== -1) {
    headerIdx = i;
    break;
  }
}
if (headerIdx === -1) {
  console.error("לא נמצאה שורת כותרת");
  process.exit(1);
}

const idx = {
  date: findIdx(aoa[headerIdx], HEADERS.date),
  valueDate: findIdx(aoa[headerIdx], HEADERS.valueDate),
  ref: findIdx(aoa[headerIdx], HEADERS.reference),
  desc: findIdx(aoa[headerIdx], HEADERS.description),
  debit: findIdx(aoa[headerIdx], HEADERS.debit),
  credit: findIdx(aoa[headerIdx], HEADERS.credit),
  ext: findIdx(aoa[headerIdx], HEADERS.extended),
  note: findIdx(aoa[headerIdx], HEADERS.note),
};

function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    return new Date(Math.floor(v - 25569) * 86400 * 1000);
  }
  if (typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}
function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s₪]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
function normalizeRef(ref) {
  if (!ref) return null;
  const t = String(ref).trim();
  if (!t) return null;
  return t.replace(/^699/, "") || t;
}
function makeDedupKey(parts) {
  return crypto
    .createHash("sha256")
    .update(parts.map((p) => p ?? "").join("|"))
    .digest("hex")
    .slice(0, 32);
}
function extractFromExtended(text) {
  if (!text) return { name: null, account: null };
  const accountMatch = text.match(/(\d{1,3}-\d{1,3}-\d{4,12})/);
  const account = accountMatch ? accountMatch[1] : null;
  let name = null;
  const m = text.match(/העברה\s+מאת:?\s*(.+?)(?=\s+\d{1,3}-\d{1,3}-\d{4,12}|$)/);
  if (m) name = m[1].trim();
  return { name, account };
}

const rows = [];
for (let i = headerIdx + 1; i < aoa.length; i++) {
  const r = aoa[i];
  if (!r || r.every((c) => c === null || c === "")) continue;
  const credit = toNumber(r[idx.credit]);
  if (credit <= 0) continue;
  const txDate = toDate(r[idx.date]);
  if (!txDate) continue;
  const ref = r[idx.ref] != null ? String(r[idx.ref]).trim() : null;
  const description = r[idx.desc] != null ? String(r[idx.desc]).trim() : null;
  const extended = r[idx.ext] != null ? String(r[idx.ext]).trim() : null;
  const note =
    idx.note >= 0 && r[idx.note] != null ? String(r[idx.note]).trim() : null;
  const { name, account } = extractFromExtended(extended);
  rows.push({
    txDate,
    valueDate: toDate(r[idx.valueDate]),
    description,
    reference: ref,
    amount: credit,
    extendedDescription: extended,
    note,
    extractedName: name,
    extractedAccount: account,
    dedupKey: makeDedupKey([
      txDate.toISOString().slice(0, 10),
      normalizeRef(ref),
      credit,
      extended,
    ]),
  });
}

console.log(`✓ פוסר: ${rows.length} תנועות זכות`);

const dates = rows.map((r) => r.txDate.getTime());
const dateFrom = new Date(Math.min(...dates));
const dateTo = new Date(Math.max(...dates));

// יצירת רשומת bank_uploads
const now = Math.floor(Date.now() / 1000);
const uploadRes = await client.execute({
  sql: `INSERT INTO bank_uploads (user_id, file_name, file_hash, row_count, date_from, date_to, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  args: [
    userId,
    fileName,
    fileHash,
    rows.length,
    Math.floor(dateFrom.getTime() / 1000),
    Math.floor(dateTo.getTime() / 1000),
    now,
  ],
});
const uploadId = Number(uploadRes.rows[0].id);
console.log(`✓ נוצרה רשומת upload #${uploadId}`);

// Upsert
let inserted = 0;
let updated = 0;
for (const r of rows) {
  // ננסה INSERT — אם conflict על dedup_key, נעדכן את השדות הרלוונטיים
  // המודל עוקב אחרי upload route בדיוק.
  const existing = await client.execute({
    sql: "SELECT id FROM bank_transactions WHERE dedup_key = ?",
    args: [r.dedupKey],
  });
  if (existing.rows.length > 0) {
    await client.execute({
      sql: `UPDATE bank_transactions
            SET reference = ?, description = ?, extended_description = ?,
                extracted_name = ?, extracted_account = ?, value_date = ?, note = ?
            WHERE dedup_key = ?`,
      args: [
        r.reference,
        r.description,
        r.extendedDescription,
        r.extractedName,
        r.extractedAccount,
        r.valueDate ? Math.floor(r.valueDate.getTime() / 1000) : null,
        r.note,
        r.dedupKey,
      ],
    });
    updated++;
  } else {
    await client.execute({
      sql: `INSERT INTO bank_transactions
            (upload_id, tx_date, value_date, description, reference, amount,
             extended_description, note, extracted_name, extracted_account, dedup_key, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        uploadId,
        Math.floor(r.txDate.getTime() / 1000),
        r.valueDate ? Math.floor(r.valueDate.getTime() / 1000) : null,
        r.description,
        r.reference,
        r.amount,
        r.extendedDescription,
        r.note,
        r.extractedName,
        r.extractedAccount,
        r.dedupKey,
        now,
      ],
    });
    inserted++;
  }
}

console.log(`\n✅ סיכום:`);
console.log(`   חדשות שהוכנסו: ${inserted}`);
console.log(`   קיימות שעודכנו: ${updated}`);
console.log(`   טווח תאריכים: ${dateFrom.toISOString().slice(0, 10)} → ${dateTo.toISOString().slice(0, 10)}`);
console.log(`   uploadId: ${uploadId}`);

// סך תנועות בנק עכשיו
const totalRes = await client.execute("SELECT COUNT(*) as c FROM bank_transactions");
console.log(`\n📊 סה"כ תנועות בנק ב-DB: ${totalRes.rows[0].c}`);

await client.close();
