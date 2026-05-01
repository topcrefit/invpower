import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: "C:/DEV/INVPOWER/.env.local" });
const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// בדוק אם העמודה כבר קיימת
const cols = await client.execute("PRAGMA table_info(fireberry_purchases)");
const hasIt = cols.rows.some((r) => r.name === "invoice_lines_description");

if (hasIt) {
  console.log("✓ העמודה invoice_lines_description כבר קיימת — אין מה לעשות");
} else {
  await client.execute(
    "ALTER TABLE fireberry_purchases ADD COLUMN invoice_lines_description TEXT"
  );
  console.log("✅ נוספה עמודה invoice_lines_description");
}

// אימות
const cols2 = await client.execute("PRAGMA table_info(fireberry_purchases)");
console.log("\nעמודות נוכחיות בטבלה:");
for (const r of cols2.rows) console.log(`  - ${r.name} (${r.type})`);

await client.close();
