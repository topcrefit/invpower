import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { fetchBankSheetRows, findMatchingRow } from "../src/lib/google-sheets/client";
import { createClient } from "@libsql/client";

async function main() {
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const inv = await c.execute(
    "SELECT cardcom_invoice_number, customer_name, amount, asmachta, tx_date FROM issued_invoices WHERE cardcom_invoice_number IN ('51067','51068','51069','51070')"
  );

  const sheetRows = await fetchBankSheetRows();
  console.log(`Sheet has ${sheetRows.length} rows`);

  for (const row of inv.rows) {
    const txDate = new Date(Number(row.tx_date) * 1000);
    const ref = String(row.asmachta);
    const amount = Number(row.amount);
    const inv = String(row.cardcom_invoice_number);
    console.log(
      `\n#${inv} | ${row.customer_name} | ${amount} | ref=${ref} | date=${txDate.toISOString().slice(0, 10)}`
    );
    const match = findMatchingRow(sheetRows, ref, amount, txDate);
    if (match) {
      console.log(
        `  → row ${match.rowIndex} | status="${match.status}" | (date in sheet: ${match.date})`
      );
    } else {
      console.log("  → NOT FOUND in sheet");
    }
  }
  await c.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
