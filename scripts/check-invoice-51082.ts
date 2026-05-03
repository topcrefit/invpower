import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { createClient } from "@libsql/client";

async function main() {
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  console.log("=== cardcom_invoices ===");
  const cc = await c.execute(
    "SELECT invoice_number, customer_name, asmachta, total_include_vat, invoice_date FROM cardcom_invoices WHERE invoice_number IN ('51082','51081','51080','51079','51078','51075','51074','51073','51072') OR asmachta='51082' ORDER BY invoice_number DESC"
  );
  for (const r of cc.rows) console.log(r);

  console.log("\n=== issued_invoices ===");
  const ii = await c.execute(
    "SELECT cardcom_invoice_number, customer_name, asmachta, amount FROM issued_invoices WHERE cardcom_invoice_number IN ('51082','51081','51080','51079','51078','51075','51074','51073','51072') ORDER BY cardcom_invoice_number DESC"
  );
  for (const r of ii.rows) console.log(r);

  console.log("\n=== highest cardcom invoice in DB ===");
  const max = await c.execute("SELECT MAX(CAST(invoice_number AS INTEGER)) as max FROM cardcom_invoices");
  console.log(max.rows[0]);

  await c.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
