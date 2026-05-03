import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { syncFireberryPurchases } from "@/lib/fireberry/sync";
import { createClient } from "@libsql/client";

async function main() {
  console.log("Starting Fireberry sync...");
  const result = await syncFireberryPurchases();
  console.log(`Done: created=${result.created}, updated=${result.updated}, total=${result.total}`);

  // Verify the Fadi records now have data
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const r = await c.execute(
    "SELECT id, customer_name, customer_tax_id, customer_phone FROM fireberry_purchases WHERE customer_name LIKE '%פאדי%'"
  );
  console.log("\n=== After sync ===");
  for (const row of r.rows) {
    console.log(`#${row.id} ${row.customer_name} | id=${row.customer_tax_id} | phone=${row.customer_phone}`);
  }
  await c.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
