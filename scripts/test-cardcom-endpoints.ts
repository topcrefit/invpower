// בדיקה איזה endpoint עובד ב-Cardcom להפקת חשבונית
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const creds = await getCardcomCreds();
  if (!creds) throw new Error("no creds");
  console.log("baseUrl:", creds.baseUrl);
  console.log("apiName:", creds.apiName);
  console.log("terminal:", creds.terminalNumber);

  const minimalBody = {
    ApiName: creds.apiName,
    ApiPassword: creds.apiPassword,
    TerminalNumber: creds.terminalNumber,
    InvoiceType: 3,
    InvoiceHead: { CustName: "TEST", Language: "he", CoinID: 1 },
    InvoiceLines: [{ Description: "test", Price: 1, Quantity: 1 }],
  };

  // נסיון endpoints שונים — רק HEAD/בדיקת קיום בלי לשלוח גוף שיפיק חשבונית אמיתית
  const endpoints = [
    "/api/v11/Documents/CreateDocument",
    "/api/v11/Documents/Create",
    "/api/v11/Documents/CreateInvoice",
    "/api/v11/Documents/CreateTaxInvoice",
    "/api/v11/Account/CreateInvoice",
    "/api/v11/Invoice/Create",
    "/Interface/BillGoldGetLowProfileIndicator",
    "/api/v11/Account/CreateTaxInvoice",
  ];

  for (const path of endpoints) {
    const url = `${creds.baseUrl}${path}`;
    try {
      // שולחים body invalid כדי לראות הודעת שגיאה — אם 404 אז ה-endpoint לא קיים
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });
      const text = await res.text();
      let snippet = text.slice(0, 200);
      let status = "exists";
      if (res.status === 404) status = "404 (לא קיים)";
      else if (text.includes("No HTTP resource")) status = "404-text";
      console.log(`${path}: status ${res.status} — ${status}`);
      if (res.status !== 404 && !text.includes("No HTTP resource")) {
        console.log(`    preview: ${snippet}`);
      }
    } catch (e) {
      console.log(`${path}: ERROR ${e instanceof Error ? e.message : e}`);
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
