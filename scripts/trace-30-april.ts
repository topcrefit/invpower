import { config } from "dotenv";
config({ path: "C:/DEV/INVPOWER/.env.local" });
import { createClient } from "@libsql/client";
import { nameSimilarity, amountsEqual } from "../src/lib/match/name-match";

const MS_DAY = 86400 * 1000;

async function main() {
  const c = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  // 30/04 in IL = 29/04 21:00 UTC to 30/04 21:00 UTC
  const start = Math.floor(new Date("2026-04-29T20:30:00Z").getTime() / 1000);
  const end = Math.floor(new Date("2026-04-30T21:30:00Z").getTime() / 1000);
  const txRes = await c.execute({
    sql: "SELECT id, tx_date, amount, reference, extracted_name FROM bank_transactions WHERE tx_date BETWEEN ? AND ? ORDER BY id",
    args: [start, end],
  });
  console.log(`30/04 bank tx: ${txRes.rows.length}`);

  const fbAll = (
    await c.execute(
      "SELECT id, customer_name, price, created_on, invoice_status_name FROM fireberry_purchases"
    )
  ).rows.map((r) => ({
    id: Number(r.id),
    name: String(r.customer_name ?? ""),
    price: Number(r.price ?? 0),
    createdOn: r.created_on ? new Date(Number(r.created_on) * 1000) : null,
    status: String(r.invoice_status_name ?? ""),
  }));
  const fbNotSent = fbAll.filter((r) => r.status === "לא נשלח");
  const fbSent = fbAll.filter((r) => r.status === "נשלח");

  const cc = (
    await c.execute(
      "SELECT id, customer_name, total_include_vat, invoice_number FROM cardcom_invoices"
    )
  ).rows.map((r) => ({
    id: Number(r.id),
    name: String(r.customer_name ?? ""),
    total: Number(r.total_include_vat ?? 0),
    invoiceNumber: String(r.invoice_number ?? ""),
  }));

  for (const row of txRes.rows) {
    const txName = String(row.extracted_name ?? "");
    const txAmount = Number(row.amount);
    const txTime = Number(row.tx_date) * 1000;
    console.log(`\n=== ${txName} ${txAmount}₪ (id=${row.id}, ref=${row.reference})`);

    // Cardcom
    const ccMatches = cc
      .filter((x) => amountsEqual(txAmount, x.total))
      .map((x) => ({
        invoiceNumber: x.invoiceNumber,
        name: x.name,
        sim: nameSimilarity(txName, x.name),
      }))
      .sort((a, b) => b.sim - a.sim);
    if (ccMatches.length > 0) {
      console.log(`  Cardcom matches (top 3):`);
      for (const m of ccMatches.slice(0, 3)) {
        console.log(`    #${m.invoiceNumber} ${m.name} — sim=${m.sim.toFixed(2)}`);
      }
    } else {
      console.log(`  Cardcom: 0 matches at this amount`);
    }

    // Fireberry "לא נשלח"
    const fbnMatches = fbNotSent
      .filter((x) => amountsEqual(txAmount, x.price))
      .map((x) => {
        const fbT = x.createdOn ? x.createdOn.getTime() : txTime;
        return {
          name: x.name,
          sim: nameSimilarity(txName, x.name),
          days: Math.abs(fbT - txTime) / MS_DAY,
        };
      })
      .sort((a, b) => b.sim - a.sim);
    if (fbnMatches.length > 0) {
      console.log(`  Fireberry "לא נשלח" matches:`);
      for (const m of fbnMatches.slice(0, 3)) {
        console.log(
          `    ${m.name} — sim=${m.sim.toFixed(2)}, days=${m.days.toFixed(1)}`
        );
      }
    } else {
      console.log(`  Fireberry "לא נשלח": 0 matches at this amount`);
    }

    // Fireberry "נשלח"
    const fbsMatches = fbSent
      .filter((x) => amountsEqual(txAmount, x.price))
      .map((x) => {
        const fbT = x.createdOn ? x.createdOn.getTime() : txTime;
        return {
          name: x.name,
          sim: nameSimilarity(txName, x.name),
          days: Math.abs(fbT - txTime) / MS_DAY,
        };
      })
      .filter((x) => x.days <= 30)
      .sort((a, b) => b.sim - a.sim);
    if (fbsMatches.length > 0) {
      console.log(`  Fireberry "נשלח" close matches:`);
      for (const m of fbsMatches.slice(0, 3)) {
        console.log(
          `    ${m.name} — sim=${m.sim.toFixed(2)}, days=${m.days.toFixed(1)}`
        );
      }
    }
  }

  await c.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
