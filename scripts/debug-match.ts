import { config } from "dotenv";
config({ path: "C:/DEV/INVPOWER/.env.local" });
import { createClient } from "@libsql/client";
import { nameSimilarity } from "../src/lib/match/name-match";

async function main() {
const c = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const txRes = await c.execute(
  "SELECT id, tx_date, extracted_name, amount FROM bank_transactions WHERE id = 770"
);
const tx = txRes.rows[0];
const txName = String(tx.extracted_name);
const txAmount = Number(tx.amount);
const txTime = Number(tx.tx_date) * 1000;
console.log(`Bank tx: ${txName} ${txAmount} at ${new Date(txTime).toISOString()}`);

const fbRes = await c.execute(
  "SELECT id, customer_name, price, created_on, invoice_status_name FROM fireberry_purchases WHERE price = 500 AND invoice_status_name = 'לא נשלח'"
);
console.log("\nMatches for 500₪ Fireberry 'לא נשלח':");
for (const r of fbRes.rows) {
  const fbName = String(r.customer_name);
  const fbTime = r.created_on ? Number(r.created_on) * 1000 : 0;
  const daysDiff = Math.abs(fbTime - txTime) / 86400000;
  const sim = nameSimilarity(txName, fbName);
  console.log(
    `  id=${r.id} | ${fbName.padEnd(20)} | sim=${sim.toFixed(2)} | daysDiff=${daysDiff.toFixed(1)}`
  );
}

await c.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
