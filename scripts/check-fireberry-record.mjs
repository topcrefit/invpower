import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: "C:/DEV/INVPOWER/.env.local" });
const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const res = await client.execute(
  "SELECT id, customer_name, customer_tax_id, customer_phone, customer_email, invoice_lines_description, raw_json FROM fireberry_purchases LIMIT 25"
);
console.log("=== כל 21 הרשומות עם השדות הקריטיים:");
for (const r of res.rows) {
  console.log(
    `  id=${r.id} | ${r.customer_name} | ת.ז.=${r.customer_tax_id ?? "(null)"} | נייד=${r.customer_phone ?? "(null)"} | תיאור="${r.invoice_lines_description ?? "(null)"}"`
  );
}

// בדיקת אבו אלקום אמאל ספציפית
console.log("\n=== חיפוש 'אבו אלקום' או 'אמאל':");
const search = await client.execute({
  sql: "SELECT id, customer_name, customer_tax_id, customer_phone, raw_json FROM fireberry_purchases WHERE customer_name LIKE ? OR customer_name LIKE ?",
  args: ["%אבו אלקום%", "%אמאל%"],
});
for (const r of search.rows) {
  console.log(`  ${r.customer_name}`);
  console.log(`    ת.ז.: ${r.customer_tax_id}`);
  console.log(`    נייד: ${r.customer_phone}`);
  // הצג חלק מ-raw_json לבדוק אם השדות מקוריים בכלל
  const raw = JSON.parse(r.raw_json);
  console.log(`    raw accountid: ${raw.accountid}`);
  console.log(`    raw idnumber: ${raw.idnumber}`);
  console.log(`    raw mobilephone: ${raw.mobilephone}`);
  console.log(`    raw phone: ${raw.phone}`);
  console.log(`    raw telephone1: ${raw.telephone1}`);
  console.log(`    raw productname: ${raw.productname}`);
  console.log(`    raw pcfInvoiceLinesDescription: ${raw.pcfInvoiceLinesDescription}`);
  console.log(`    raw pcfinvoicelinesdescription: ${raw.pcfinvoicelinesdescription}`);
  console.log(`    raw description: ${raw.description}`);
  console.log(`    raw accountname: ${raw.accountname}`);
  console.log(`    raw accountnumbername: ${raw.accountnumbername ?? "—"}`);
  console.log(`    כל המפתחות:`, Object.keys(raw).filter((k) => raw[k] != null && raw[k] !== "").join(", "));
}

await client.close();
