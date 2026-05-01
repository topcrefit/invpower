// סנכרון Fireberry עם logging מלא — לאתר למה ת.ז./נייד/תיאור ריקים
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import {
  fireberryFetchPurchases,
  fireberryEnrichWithAccount,
  pickPrice,
  pickPhone,
} from "../src/lib/fireberry/client";

async function main() {

console.log("=== שולף רכישות מ-Fireberry...");
const raw = await fireberryFetchPurchases();
console.log(`✓ קיבלנו ${raw.length} רשומות אחרי 4 הפילטרים`);

if (raw.length > 0) {
  const sample = raw[0];
  console.log("\n=== דוגמה raw (לפני enrichment):");
  console.log(JSON.stringify(sample, null, 2).slice(0, 2000));
  console.log("\n=== כל המפתחות:", Object.keys(sample).join(", "));
}

console.log("\n=== מעשיר מ-Account...");
const enriched = await fireberryEnrichWithAccount(raw);
console.log(`✓ enrichment הושלם`);

if (enriched.length > 0) {
  const sample = enriched[0];
  console.log("\n=== דוגמה אחרי enrichment:");
  console.log(`  שם: ${sample.accountname}`);
  console.log(`  accountid: ${sample.accountid}`);
  console.log(`  ת.ז. (idnumber): ${sample.idnumber}`);
  console.log(`  טלפון: phone=${sample.phone} mobilephone=${sample.mobilephone} telephone1=${sample.telephone1}`);
  console.log(`  pickPhone(): ${pickPhone(sample)}`);
  console.log(`  pickPrice(): ${pickPrice(sample)}`);
  console.log(`  productname: ${sample.productname}`);
  console.log(`  pcfInvoiceLinesDescription: ${sample.pcfInvoiceLinesDescription ?? "(undefined)"}`);
  console.log(`  pcfinvoicelinesdescription: ${sample.pcfinvoicelinesdescription ?? "(undefined)"}`);
}

// ספור כמה הצליחו לקבל ת.ז. וכמה לא
let withTaxId = 0;
let withPhone = 0;
let withDescription = 0;
for (const r of enriched) {
  if (r.idnumber) withTaxId++;
  if (pickPhone(r)) withPhone++;
  const desc = r.pcfInvoiceLinesDescription ?? r.pcfinvoicelinesdescription ?? null;
  if (desc) withDescription++;
}
console.log(`\n=== סיכום סנכרון:`);
console.log(`  סה"כ רשומות: ${enriched.length}`);
console.log(`  עם ת.ז.: ${withTaxId}`);
console.log(`  עם נייד: ${withPhone}`);
console.log(`  עם תיאור (pcfInvoiceLinesDescription): ${withDescription}`);

process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
