// אימות: ל-72 תנועות בנק שמסומנות "ללא חשבונית" — האם באמת אין להן רשומה ב-Fireberry?
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { createClient } from "@libsql/client";
import { getFireberryCreds, getCardcomCreds } from "../src/lib/settings/store";
import { nameSimilarity, amountsEqual } from "../src/lib/match/name-match";

async function main() {
  const dbClient = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const fbCreds = await getFireberryCreds();
  const ccCreds = await getCardcomCreds();
  if (!fbCreds || !ccCreds) throw new Error("missing creds");

  // 1. כל תנועות הבנק
  const txRes = await dbClient.execute(
    "SELECT id, tx_date, amount, reference, extracted_name FROM bank_transactions WHERE tx_date >= ? ORDER BY tx_date",
    [Math.floor(new Date("2026-01-01").getTime() / 1000)]
  );
  const txs = txRes.rows.map((r) => ({
    id: Number(r.id),
    txDate: new Date(Number(r.tx_date) * 1000),
    amount: Number(r.amount),
    reference: String(r.reference ?? ""),
    name: r.extracted_name ? String(r.extracted_name) : "",
  }));

  // 2. הרשומות ב-Fireberry שיש לנו ב-DB ("לא נשלח")
  const fbDbRes = await dbClient.execute(
    "SELECT account_product_id, customer_name, price FROM fireberry_purchases"
  );
  const fbInDB = fbDbRes.rows.map((r) => ({
    apId: String(r.account_product_id),
    name: String(r.customer_name ?? ""),
    price: Number(r.price ?? 0),
  }));

  // 3. כל החשבוניות ב-Cardcom (מ-DB מקומי)
  const ccDbRes = await dbClient.execute(
    "SELECT customer_name, total_include_vat FROM cardcom_invoices"
  );
  const ccInDB = ccDbRes.rows.map((r) => ({
    name: String(r.customer_name ?? ""),
    total: Number(r.total_include_vat ?? 0),
  }));

  // 4. שלוף את כל רשומות Fireberry (גם "נשלח") כדי לבדוק
  console.log("=== שולף את כל רשומות Fireberry (כולל 'נשלח')...");
  const allFb: Array<{ name: string; price: number; status: string; created: string }> = [];
  let page = 1;
  while (true) {
    const body = {
      objecttype: 33,
      page_size: 500,
      page_number: page,
      fields: "accountname,accountproductid,price,createdon,pcfsystemfield147name,pcfsystemfield73name",
      sort_by: "createdon",
      sort_type: "desc",
      query: "(createdon >= '2026-01-01')",
    };
    const res = await fetch(`${fbCreds.baseUrl}/api/query`, {
      method: "POST",
      headers: {
        tokenid: fbCreds.token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    const recs = j.data?.Data ?? j.data?.Records ?? [];
    for (const r of recs) {
      const payment = String(r.pcfsystemfield73name ?? "");
      if (payment !== "העברה בנקאית") continue;
      const price = Number(r.price ?? 0);
      if (price <= 0.9) continue;
      allFb.push({
        name: String(r.accountname ?? ""),
        price,
        status: String(r.pcfsystemfield147name ?? ""),
        created: String(r.createdon ?? "").slice(0, 10),
      });
    }
    if (recs.length < 500) break;
    page++;
    if (page > 20) break;
  }
  console.log(`✓ נטענו ${allFb.length} רשומות Fireberry (כולל "נשלח")`);
  const byStatus: Record<string, number> = {};
  for (const r of allFb) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  console.log(`   חלוקה לפי סטטוס:`, byStatus);

  // 5. לכל תנועת בנק — בדוק אם יש לה רשומה ב-Fireberry, ובאיזה סטטוס
  let noMatchCount = 0;
  let hasFbNotSent = 0;
  let hasFbSent = 0;
  let hasCardcom = 0;
  let trulyNoMatch = 0;
  const trulyMissing: typeof txs = [];
  const fbSentMissed: Array<{ tx: typeof txs[0]; fb: typeof allFb[0] }> = [];

  for (const tx of txs) {
    // האם יש Cardcom?
    let foundCardcom = false;
    for (const cc of ccInDB) {
      if (!amountsEqual(tx.amount, cc.total)) continue;
      const sim = nameSimilarity(tx.name, cc.name);
      if (sim >= 0.7) {
        foundCardcom = true;
        break;
      }
    }
    if (foundCardcom) {
      hasCardcom++;
      continue;
    }

    // האם יש Fireberry "לא נשלח"?
    let foundFbNotSent = false;
    for (const fb of fbInDB) {
      if (!amountsEqual(tx.amount, fb.price)) continue;
      const sim = nameSimilarity(tx.name, fb.name);
      if (sim >= 0.5) {
        foundFbNotSent = true;
        break;
      }
    }
    if (foundFbNotSent) {
      hasFbNotSent++;
      continue;
    }

    // לא נמצא ב-Cardcom ולא ב-Fireberry "לא נשלח"
    // → בדיקה: האם יש ב-Fireberry "נשלח"?
    let foundFbSent: typeof allFb[0] | null = null;
    for (const fb of allFb) {
      if (fb.status === "לא נשלח") continue; // כבר בדקנו
      if (!amountsEqual(tx.amount, fb.price)) continue;
      const sim = nameSimilarity(tx.name, fb.name);
      if (sim >= 0.5) {
        foundFbSent = fb;
        break;
      }
    }
    if (foundFbSent) {
      hasFbSent++;
      fbSentMissed.push({ tx, fb: foundFbSent });
      continue;
    }

    trulyNoMatch++;
    trulyMissing.push(tx);
  }

  console.log(`\n📊 סיכום עבור ${txs.length} תנועות בנק:`);
  console.log(`   ✓ יש Cardcom: ${hasCardcom}`);
  console.log(`   🟢 יש Fireberry "לא נשלח": ${hasFbNotSent}`);
  console.log(`   🟡 יש Fireberry "נשלח" (פספסנו): ${hasFbSent}`);
  console.log(`   ❌ באמת ללא: ${trulyNoMatch}`);

  if (fbSentMissed.length > 0) {
    console.log(`\n=== ${fbSentMissed.length} תנועות שיש להן Fireberry "נשלח" שאנחנו לא רואים:`);
    for (const m of fbSentMissed.slice(0, 30)) {
      console.log(
        `   ${m.tx.txDate.toISOString().slice(0, 10)} | ${m.tx.amount.toFixed(0)} | ${m.tx.name} → Fireberry: ${m.fb.name} (${m.fb.status})`
      );
    }
  }

  await dbClient.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
