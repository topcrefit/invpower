import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: "C:/DEV/INVPOWER/.env.local" });
const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? "",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const uploads = await client.execute("SELECT id, file_name, row_count, date_from, date_to, uploaded_at FROM bank_uploads ORDER BY id");
console.log("=== bank_uploads:");
for (const r of uploads.rows) {
  const dateFrom = r.date_from ? new Date(Number(r.date_from) * 1000).toISOString().slice(0, 10) : "?";
  const dateTo = r.date_to ? new Date(Number(r.date_to) * 1000).toISOString().slice(0, 10) : "?";
  console.log(`  id=${r.id}: ${r.file_name} | rows=${r.row_count} | ${dateFrom} → ${dateTo}`);
}

const total = await client.execute("SELECT COUNT(*) c, MIN(tx_date) min_d, MAX(tx_date) max_d FROM bank_transactions");
const r0 = total.rows[0];
console.log(`\n=== bank_transactions total: ${r0.c}`);
console.log(`    earliest: ${new Date(Number(r0.min_d) * 1000).toISOString().slice(0, 10)}`);
console.log(`    latest:   ${new Date(Number(r0.max_d) * 1000).toISOString().slice(0, 10)}`);

const byDate = await client.execute(
  "SELECT DATE(tx_date, 'unixepoch') d, COUNT(*) c FROM bank_transactions GROUP BY d ORDER BY d DESC LIMIT 10"
);
console.log("\n=== Transactions per date (latest 10 days):");
for (const r of byDate.rows) console.log(`    ${r.d}: ${r.c}`);

await client.close();
