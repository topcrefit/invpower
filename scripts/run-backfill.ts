import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { backfillFireberryAccountInfo } from "@/lib/fireberry/backfill";
import { createClient } from "@libsql/client";

async function main() {
  console.log("Running Fireberry account backfill...");
  const r = await backfillFireberryAccountInfo();
  console.log(`Candidates: ${r.candidates}, Updated: ${r.updated}, Failed: ${r.failed}`);

  // Verify Fadi
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const res = await c.execute(
    "SELECT id, customer_name, customer_tax_id, customer_phone FROM fireberry_purchases WHERE customer_name LIKE '%פאדי%'"
  );
  console.log("\n=== After backfill ===");
  for (const row of res.rows) {
    console.log(`#${row.id} ${row.customer_name} | id=${row.customer_tax_id} | phone=${row.customer_phone}`);
  }
  await c.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
