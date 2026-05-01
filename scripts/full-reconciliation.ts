// ביקורת מלאה: לכל רכישה ב-Fireberry שמסומנת "לא נשלח" — האם באמת אין חשבונית?
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { createClient } from "@libsql/client";
import { getCardcomCreds } from "../src/lib/settings/store";
import { nameSimilarity, amountsEqual } from "../src/lib/match/name-match";

async function main() {
  const dbClient = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const cc = await getCardcomCreds();
  if (!cc) throw new Error("no cardcom creds");

  // 1. כל הרכישות ב-DB (לאחר סנכרון: status="לא נשלח" ב-Fireberry)
  const fbRes = await dbClient.execute(
    "SELECT id, account_product_id, customer_name, customer_tax_id, price, created_on, modified_on FROM fireberry_purchases ORDER BY created_on"
  );
  const fbRows = fbRes.rows.map((r) => ({
    id: Number(r.id),
    apId: String(r.account_product_id),
    name: r.customer_name ? String(r.customer_name) : "",
    taxId: r.customer_tax_id ? String(r.customer_tax_id) : "",
    price: Number(r.price ?? 0),
    createdOn: r.created_on ? new Date(Number(r.created_on) * 1000) : null,
    modifiedOn: r.modified_on ? new Date(Number(r.modified_on) * 1000) : null,
  }));
  console.log(`📊 רכישות ב-Fireberry במצב "לא נשלח": ${fbRows.length}`);

  // 2. שלוף את כל החשבוניות מ-Cardcom (Jan-May 2026)
  const allInvoices: Array<{
    invoiceNumber: number;
    invoiceType: number;
    customerName: string;
    customerId: string;
    total: number;
    invoiceDate: string;
  }> = [];
  for (const docType of [1, 2, 3, 305]) {
    let page = 1;
    while (true) {
      const body = {
        ApiName: cc.apiName,
        ApiPassword: cc.apiPassword,
        TerminalNumber: Number(cc.terminalNumber),
        FromDateYYYYMMDD: "20260101",
        ToDateYYYYMMDD: "20260531",
        DocType: docType,
        PageNumber: page,
        ItemsPerPage: 500,
      };
      const res = await fetch(`${cc.baseUrl}/api/v11/Documents/GetReport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (j.ResponseCode !== 0) break;
      const docs = j.Documents ?? [];
      for (const d of docs) {
        allInvoices.push({
          invoiceNumber: d.Invoice_Number,
          invoiceType: d.InvoiceType,
          customerName: d.Cust_Name ?? "",
          customerId: d.Comp_ID ?? "",
          total: d.TotalIncludeVATNIS ?? 0,
          invoiceDate: d.InvoiceDateOnly ?? d.InvoiceDate,
        });
      }
      if (docs.length < 500) break;
      page++;
      if (page > 20) break;
    }
  }
  console.log(`📜 חשבוניות בקארדקום (Jan-May 2026): ${allInvoices.length}`);

  // 3. לכל רכישה — בדוק אם יש כבר חשבונית (לפי שם + סכום)
  console.log(`\n${"שם".padEnd(28)} ${"סכום".padEnd(8)} ${"נוצר".padEnd(11)} סטטוס`);
  console.log("─".repeat(80));

  const reallyMissing: typeof fbRows = [];
  const alreadyHasInvoice: Array<{ row: typeof fbRows[0]; invoice: typeof allInvoices[0] }> = [];

  for (const fb of fbRows) {
    let bestMatch: typeof allInvoices[0] | null = null;
    let bestSim = 0;
    for (const inv of allInvoices) {
      if (!amountsEqual(fb.price, inv.total)) continue;
      const sim = nameSimilarity(fb.name, inv.customerName);
      if (sim > bestSim) {
        bestSim = sim;
        bestMatch = inv;
      }
    }
    if (bestMatch && bestSim >= 0.8) {
      alreadyHasInvoice.push({ row: fb, invoice: bestMatch });
      console.log(
        `${fb.name.padEnd(28)} ${fb.price.toFixed(0).padEnd(8)} ${fb.createdOn?.toISOString().slice(0, 10) ?? "?"} ✅ חשבונית #${bestMatch.invoiceNumber} (${(bestSim * 100).toFixed(0)}%)`
      );
    } else if (bestMatch && bestSim >= 0.5) {
      console.log(
        `${fb.name.padEnd(28)} ${fb.price.toFixed(0).padEnd(8)} ${fb.createdOn?.toISOString().slice(0, 10) ?? "?"} ⚠️  אולי #${bestMatch.invoiceNumber} (${(bestSim * 100).toFixed(0)}%) — ${bestMatch.customerName}`
      );
      reallyMissing.push(fb);
    } else {
      reallyMissing.push(fb);
      console.log(
        `${fb.name.padEnd(28)} ${fb.price.toFixed(0).padEnd(8)} ${fb.createdOn?.toISOString().slice(0, 10) ?? "?"} ❌ אין חשבונית`
      );
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log(`📊 סיכום:`);
  console.log(`   רכישות ב-Fireberry "לא נשלח": ${fbRows.length}`);
  console.log(`   ✅ כבר יש להן חשבונית בקארדקום (Fireberry צריך עדכון): ${alreadyHasInvoice.length}`);
  console.log(`   ❌ באמת חסרה חשבונית (צריך הפקה): ${reallyMissing.length}`);

  await dbClient.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
