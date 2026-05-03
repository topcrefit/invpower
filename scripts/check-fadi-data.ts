import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { createClient } from "@libsql/client";

async function main() {
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  console.log("=== Fireberry purchases with שם 'פאדי' ===");
  const r = await c.execute(
    "SELECT id, customer_name, customer_tax_id, customer_phone, account_id, raw_json FROM fireberry_purchases WHERE customer_name LIKE '%פאדי%'"
  );
  for (const row of r.rows) {
    console.log(`\n#${row.id} | name=${row.customer_name}`);
    console.log(`  customer_tax_id=${row.customer_tax_id}`);
    console.log(`  customer_phone=${row.customer_phone}`);
    console.log(`  account_id=${row.account_id}`);
    const raw = JSON.parse(String(row.raw_json));
    console.log(`  raw.idnumber=${raw.idnumber}`);
    console.log(`  raw.mobilephone=${raw.mobilephone}`);
    console.log(`  raw.phone=${raw.phone}`);
    console.log(`  raw.telephone1=${raw.telephone1}`);
  }
  await c.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
