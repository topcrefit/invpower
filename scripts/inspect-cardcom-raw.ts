import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { createClient } from "@libsql/client";

async function main() {
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  // pick 2 invoices to inspect
  const r = await c.execute(
    "SELECT invoice_number, raw_data FROM cardcom_invoices WHERE raw_data IS NOT NULL LIMIT 2"
  );
  for (const row of r.rows) {
    console.log(`\n=== Invoice ${row.invoice_number} ===`);
    const raw = JSON.parse(String(row.raw_data));
    console.log("Keys:", Object.keys(raw));
    console.log("Full object:", JSON.stringify(raw, null, 2));
  }
  await c.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
