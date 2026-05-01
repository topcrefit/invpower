import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { createClient } from "@libsql/client";

async function main() {
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const r = await c.execute(
    "SELECT cardcom_invoice_number, customer_name, amount, asmachta, tx_date FROM issued_invoices ORDER BY cardcom_invoice_number DESC LIMIT 10"
  );
  for (const row of r.rows) {
    const d = new Date(Number(row.tx_date) * 1000);
    console.log(
      `#${row.cardcom_invoice_number} | ${row.customer_name} | ${row.amount} | ref=${row.asmachta} | date=${d.toISOString().slice(0, 10)}`
    );
  }
  await c.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
