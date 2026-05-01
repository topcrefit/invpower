import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { createClient } from "@libsql/client";

async function main() {
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  console.log("=== bank_transaction id=10 (linked to invoice 51070) ===");
  const bt0 = await c.execute(
    "SELECT id, tx_date, amount, reference, extracted_name, extended_description FROM bank_transactions WHERE id=10"
  );
  for (const r of bt0.rows) {
    const d = new Date(Number(r.tx_date) * 1000);
    console.log(`id=${r.id} | ${d.toISOString().slice(0, 10)} | ${r.amount} | ref=${r.reference} | name=${r.extracted_name}`);
    console.log(`  ext=${r.extended_description}`);
  }

  console.log("\n=== bank_transactions matching ref 120475 / 62824 / names ===");
  const bt = await c.execute(
    "SELECT id, tx_date, amount, reference, extracted_name FROM bank_transactions WHERE reference IN ('120475','62824') OR extracted_name LIKE '%עבד אל האדי%' OR extracted_name LIKE '%שאדי%'"
  );
  for (const r of bt.rows) {
    const d = new Date(Number(r.tx_date) * 1000);
    console.log(`id=${r.id} | ${d.toISOString().slice(0, 10)} | ${r.amount} | ref=${r.reference} | ${r.extracted_name}`);
  }

  console.log("\n=== fireberry_purchases related (purchase id 604) ===");
  const fp0 = await c.execute(
    "SELECT * FROM fireberry_purchases WHERE id=604"
  );
  for (const r of fp0.rows) console.log(r);

  console.log("\n=== fireberry purchases for עבד אל האדי / שאדי ===");
  const fp = await c.execute(
    "SELECT id, object_id, account_id, account_name, amount, asmachta, status FROM fireberry_purchases WHERE account_name LIKE '%עבד אל האדי%' OR account_name LIKE '%שאדי%' LIMIT 30"
  );
  for (const r of fp.rows) {
    console.log(`id=${r.id} | obj=${r.object_id} | ${r.account_name} | ${r.amount} | ref=${r.asmachta} | status=${r.status}`);
  }

  await c.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
