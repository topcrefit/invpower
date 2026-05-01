import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: "C:/DEV/INVPOWER/.env.local" });
const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// קח את ה-accountid של אמאל
const accountId = "a73919ec-bc72-40a9-8366-934d8a451277";

// טען credentials מ-DB
const creds = await client.execute(
  "SELECT key, value FROM settings WHERE key IN ('fireberry_token', 'fireberry_base_url')"
);
const map = {};
for (const r of creds.rows) map[r.key] = r.value;

const tokenRow = map["fireberry_token"];
const baseUrl = map["fireberry_base_url"] ?? "https://api.powerlink.co.il";

if (!tokenRow) {
  console.error("Fireberry token לא נמצא ב-settings");
  process.exit(1);
}

// settings ב-DB מוצפנים — נשתמש בסקריפט אחר לפענוח. כאן נדלג ונשתמש ב-curl ידני.
// במקום זה, נציג רק את ה-IDs ונציע פתרון.

console.log("=== מידע לבדיקה ידנית:");
console.log(`accountId: ${accountId}`);
console.log(`baseUrl: ${baseUrl}`);
console.log("token: (מוצפן ב-DB — צריך להריץ סנכרון מחדש מהממשק)");

// במקום זה, נחפש בכל הרשומות אם יש idnumber/phone כלשהו
const allWithFields = await client.execute(
  "SELECT id, customer_name, customer_tax_id, customer_phone, account_id FROM fireberry_purchases WHERE customer_tax_id IS NOT NULL OR customer_phone IS NOT NULL LIMIT 5"
);
console.log("\n=== רשומות עם ת.ז./נייד (אם יש):");
console.log(`נמצאו: ${allWithFields.rows.length}`);
for (const r of allWithFields.rows) {
  console.log(`  ${r.customer_name}: ת.ז.=${r.customer_tax_id}, נייד=${r.customer_phone}`);
}

await client.close();
