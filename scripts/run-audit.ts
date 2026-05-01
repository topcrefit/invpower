// קריאה ל-API של ה-audit לראות תוצאות
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { createClient } from "@libsql/client";
import { nameSimilarity, amountsEqual } from "../src/lib/match/name-match";

const MS_DAY = 86400 * 1000;

async function main() {
  const dbClient = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const txRes = await dbClient.execute(
    "SELECT id, tx_date, amount, reference, extracted_name FROM bank_transactions ORDER BY tx_date"
  );
  const txs = txRes.rows.map((r) => ({
    id: Number(r.id),
    txDate: new Date(Number(r.tx_date) * 1000),
    amount: Number(r.amount),
    name: r.extracted_name ? String(r.extracted_name) : "",
    ref: String(r.reference ?? ""),
  }));

  const fbRes = await dbClient.execute(
    "SELECT id, customer_name, price, created_on, invoice_status_name FROM fireberry_purchases"
  );
  const fbAll = fbRes.rows.map((r) => ({
    id: Number(r.id),
    name: String(r.customer_name ?? ""),
    price: Number(r.price ?? 0),
    createdOn: r.created_on ? new Date(Number(r.created_on) * 1000) : null,
    status: String(r.invoice_status_name ?? ""),
  }));
  const fbNotSent = fbAll.filter((r) => r.status === "לא נשלח");
  const fbSent = fbAll.filter((r) => r.status === "נשלח");
  console.log(`Fireberry: ${fbNotSent.length} "לא נשלח" + ${fbSent.length} "נשלח" = ${fbAll.length}`);

  const ccRes = await dbClient.execute(
    "SELECT id, customer_name, total_include_vat, invoice_number FROM cardcom_invoices"
  );
  const cc = ccRes.rows.map((r) => ({
    id: Number(r.id),
    name: String(r.customer_name ?? ""),
    total: Number(r.total_include_vat ?? 0),
    invoiceNumber: String(r.invoice_number ?? ""),
  }));
  console.log(`Cardcom: ${cc.length} חשבוניות`);
  console.log(`בנק: ${txs.length} תנועות\n`);

  const usedFb = new Set<number>();
  const usedCc = new Set<number>();
  let cardcomMatched = 0;
  let fbSentMatched = 0;
  let ready = 0;
  let noMatch = 0;
  const noMatchList: typeof txs = [];

  for (const tx of txs) {
    const txTime = tx.txDate.getTime();
    // 1. קודם — Fireberry "לא נשלח" עם תאריך קרוב
    let bestNotSent: (typeof fbAll)[number] | null = null;
    let bestSim = 0;
    let bestDays = 999;
    for (const fb of fbNotSent) {
      if (usedFb.has(fb.id)) continue;
      if (!amountsEqual(tx.amount, fb.price)) continue;
      const fbTime = fb.createdOn ? fb.createdOn.getTime() : txTime;
      const daysDiff = Math.abs(fbTime - txTime) / MS_DAY;
      if (daysDiff > 60) continue;
      const sim = nameSimilarity(tx.name, fb.name);
      const minSim = daysDiff <= 1 ? 0.5 : 0.6;
      if (sim < minSim) continue;
      if (sim > bestSim || (sim === bestSim && daysDiff < bestDays)) {
        bestSim = sim;
        bestDays = daysDiff;
        bestNotSent = fb;
      }
    }
    const is30Apr = tx.txDate.toISOString().startsWith("2026-04-29T2");
    if (bestNotSent) {
      usedFb.add(bestNotSent.id);
      ready++;
      console.log(
        `   [READY] ${tx.txDate.toISOString().slice(0, 10)} | ${tx.name} ${tx.amount} → FB "${bestNotSent.name}"`
      );
      continue;
    }

    // 2. Cardcom (לא יודעים תאריך כאן, אז סף 0.6 קבוע)
    let foundCc = false;
    for (const c of cc) {
      if (usedCc.has(c.id)) continue;
      if (!amountsEqual(tx.amount, c.total)) continue;
      const sim = nameSimilarity(tx.name, c.name);
      if (sim < 0.6) continue;
      usedCc.add(c.id);
      foundCc = true;
      break;
    }
    if (foundCc) {
      cardcomMatched++;
      if (is30Apr) {
        console.log(`   [30/04] ${tx.name} ${tx.amount} → cardcom (matched)`);
      }
      continue;
    }

    // 3. Fireberry "נשלח"
    let bestScore = -1;
    let bestSentFb: (typeof fbAll)[number] | null = null;
    for (const fb of fbSent) {
      if (usedFb.has(fb.id)) continue;
      if (!amountsEqual(tx.amount, fb.price)) continue;
      const fbTime = fb.createdOn ? fb.createdOn.getTime() : txTime;
      const daysDiff = Math.abs(fbTime - txTime) / MS_DAY;
      if (daysDiff > 21) continue;
      const sim = nameSimilarity(tx.name, fb.name);
      const minSim = daysDiff <= 1 ? 0.5 : 0.6;
      if (sim < minSim) continue;
      const score = sim * 100 - daysDiff;
      if (score > bestScore) {
        bestScore = score;
        bestSentFb = fb;
      }
    }
    if (bestSentFb) {
      usedFb.add(bestSentFb.id);
      fbSentMatched++;
      if (is30Apr) {
        console.log(`   [30/04] ${tx.name} ${tx.amount} → fb "נשלח" (${bestSentFb.name})`);
      }
      continue;
    }

    if (is30Apr) {
      console.log(`   [30/04] ${tx.name} ${tx.amount} → NO MATCH`);
    }
    noMatch++;
    noMatchList.push(tx);
  }

  console.log("📊 סיווג התנועות:");
  console.log(`   ✓ הופקה (יש ב-Cardcom):      ${cardcomMatched}`);
  console.log(`   ✓ הופקה (Fireberry "נשלח"):  ${fbSentMatched}`);
  console.log(`   🟢 מוכן להפקה (Fireberry):    ${ready}`);
  console.log(`   ❌ ללא חשבונית:               ${noMatch}`);
  console.log(`   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`   סה"כ:                        ${cardcomMatched + fbSentMatched + ready + noMatch}`);

  if (noMatchList.length > 0) {
    console.log(`\n=== ${noMatchList.length} תנועות ללא חשבונית:`);
    for (const t of noMatchList) {
      console.log(`   ${t.txDate.toISOString().slice(0, 10)} | ${t.amount.toFixed(0).padEnd(6)} | ${t.ref.padEnd(8)} | ${t.name}`);
    }
  }

  await dbClient.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
