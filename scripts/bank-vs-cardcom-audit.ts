// ביקורת מקיפה: כל תנועות הבנק מול כל החשבוניות בקארדקום
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

  // 1. כל תנועות הבנק
  const bankRes = await dbClient.execute(
    "SELECT id, tx_date, amount, reference, extracted_name, extracted_account FROM bank_transactions ORDER BY tx_date"
  );
  const bankTxs = bankRes.rows.map((r) => ({
    id: Number(r.id),
    txDate: new Date(Number(r.tx_date) * 1000),
    amount: Number(r.amount),
    reference: String(r.reference ?? ""),
    extractedName: r.extracted_name ? String(r.extracted_name) : null,
    extractedAccount: r.extracted_account ? String(r.extracted_account) : null,
  }));
  console.log(`\n📊 תנועות בנק ב-DB: ${bankTxs.length}`);
  console.log(`   טווח: ${bankTxs[0]?.txDate.toISOString().slice(0, 10)} → ${bankTxs[bankTxs.length - 1]?.txDate.toISOString().slice(0, 10)}`);

  // 2. כל החשבוניות בקארדקום (Mar-Apr 2026, כל הסוגים)
  const allInvoices: Array<{
    invoiceNumber: number;
    invoiceType: number;
    customerName: string;
    customerId: string;
    total: number;
    invoiceDate: string;
    asmachta: string | null;
  }> = [];
  for (const docType of [1, 2, 3, 305]) {
    let page = 1;
    while (true) {
      const body = {
        ApiName: cc.apiName,
        ApiPassword: cc.apiPassword,
        TerminalNumber: Number(cc.terminalNumber),
        FromDateYYYYMMDD: "20260301",
        ToDateYYYYMMDD: "20260430",
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
      if (j.ResponseCode !== 0) {
        console.error(`Cardcom error for docType=${docType}: ${j.Description}`);
        break;
      }
      const docs = j.Documents ?? [];
      for (const d of docs) {
        allInvoices.push({
          invoiceNumber: d.Invoice_Number,
          invoiceType: d.InvoiceType,
          customerName: d.Cust_Name ?? "",
          customerId: d.Comp_ID ?? "",
          total: d.TotalIncludeVATNIS ?? 0,
          invoiceDate: d.InvoiceDateOnly ?? d.InvoiceDate,
          asmachta: d.Asmachta ?? null,
        });
      }
      if (docs.length < 500) break;
      page++;
      if (page > 20) break;
    }
  }
  // ספור לפי type
  const byType: Record<number, number> = {};
  for (const i of allInvoices) byType[i.invoiceType] = (byType[i.invoiceType] ?? 0) + 1;
  console.log(`📜 חשבוניות בקארדקום (mar-apr 2026): ${allInvoices.length}`);
  console.log(`   חלוקה לפי type: ${JSON.stringify(byType)}`);

  // 3. מיפוי: לכל תנועת בנק — חיפוש חשבונית תואמת
  const MS_DAY = 86400 * 1000;
  type Match = {
    bankTx: typeof bankTxs[0];
    invoice: (typeof allInvoices)[0] | null;
    matchScore?: number;
    matchReason?: string;
  };
  const usedInvoices = new Set<number>();
  const matches: Match[] = [];

  for (const tx of bankTxs) {
    let bestInvoice: (typeof allInvoices)[0] | null = null;
    let bestScore = -1;
    let bestReason = "";

    for (const inv of allInvoices) {
      if (usedInvoices.has(inv.invoiceNumber)) continue;
      if (!amountsEqual(tx.amount, inv.total)) continue;
      const txTime = tx.txDate.getTime();
      const invTime = new Date(inv.invoiceDate).getTime();
      const daysDiff = Math.abs(invTime - txTime) / MS_DAY;
      if (daysDiff > 90) continue;

      const sim = nameSimilarity(tx.extractedName ?? "", inv.customerName);
      if (sim < 0.3) continue;

      const score = 100 + sim * 20 - daysDiff;
      if (score > bestScore) {
        bestScore = score;
        bestInvoice = inv;
        bestReason = `${(sim * 100).toFixed(0)}% שם + ${Math.round(daysDiff)} ימים`;
      }
    }

    if (bestInvoice) usedInvoices.add(bestInvoice.invoiceNumber);
    matches.push({
      bankTx: tx,
      invoice: bestInvoice,
      matchScore: bestScore,
      matchReason: bestReason,
    });
  }

  // 4. תוצאות
  const matched = matches.filter((m) => m.invoice);
  const unmatched = matches.filter((m) => !m.invoice);

  console.log(`\n✅ תנועות עם חשבונית מ-Cardcom: ${matched.length}`);
  console.log(`❌ תנועות ללא חשבונית: ${unmatched.length}`);

  console.log(`\n=== ❌ תנועות בנק ללא חשבונית (${unmatched.length}):`);
  console.log(`${"תאריך".padEnd(11)} ${"אסמכתא".padEnd(10)} ${"סכום".padEnd(10)} ${"שם בבנק"}`);
  console.log("─".repeat(90));
  for (const m of unmatched) {
    const t = m.bankTx;
    console.log(
      `${t.txDate.toISOString().slice(0, 10)} ${t.reference.padEnd(10)} ${t.amount.toFixed(2).padEnd(10)} ${t.extractedName ?? "?"}`
    );
  }

  // סך הכל
  const totalMatched = matched.reduce((s, m) => s + m.bankTx.amount, 0);
  const totalUnmatched = unmatched.reduce((s, m) => s + m.bankTx.amount, 0);
  console.log(`\n📊 סיכום:`);
  console.log(`   תנועות עם חשבונית: ${matched.length} | ${totalMatched.toFixed(2)} ₪`);
  console.log(`   תנועות ללא חשבונית: ${unmatched.length} | ${totalUnmatched.toFixed(2)} ₪`);

  // CSV של ALL התנועות
  const fs = await import("node:fs");
  const csv = ["תאריך,אסמכתא,שם בבנק,סכום,סטטוס,חשבונית_Cardcom,התאמה"];
  for (const m of matches) {
    const t = m.bankTx;
    const status = m.invoice ? "יש חשבונית" : "אין חשבונית";
    const inv = m.invoice ? m.invoice.invoiceNumber : "";
    const reason = m.invoice ? m.matchReason : "";
    csv.push(
      `${t.txDate.toISOString().slice(0, 10)},${t.reference},"${(t.extractedName ?? "").replace(/"/g, "")}",${t.amount.toFixed(2)},${status},${inv},${reason}`
    );
  }
  const csvPath = "C:/DEV/INVPOWER/scripts/audit-output.csv";
  fs.writeFileSync(csvPath, "﻿" + csv.join("\n"), "utf8");
  console.log(`\n📁 דוח מלא נשמר ב: ${csvPath}`);
  console.log(`   פתח באקסל לראות רשימה מלאה של 385 תנועות + סטטוס כל אחת`);

  await dbClient.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
