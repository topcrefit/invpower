import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const c = await getCardcomCreds();
  if (!c) throw new Error("no creds");

  // GetReport ל-30 יום אחרונים — יראה את כל החשבוניות שהפקנו
  const today = new Date();
  const fromDate = new Date(today.getTime() - 30 * 86400000);
  const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  for (const docType of [-1, 1, 3, 305, 2]) {
    const body = {
      ApiName: c.apiName,
      ApiPassword: c.apiPassword,
      TerminalNumber: Number(c.terminalNumber),
      FromDateYYYYMMDD: fmt(fromDate),
      ToDateYYYYMMDD: fmt(today),
      DocType: docType,
      PageNumber: 1,
      ItemsPerPage: 5,
    };
    const res = await fetch(`${c.baseUrl}/api/v11/Documents/GetReport`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    console.log(`\nDocType=${docType}: ResponseCode=${j.ResponseCode}, ${j.Documents?.length ?? 0} documents`);
    if (j.Documents) {
      for (const d of j.Documents.slice(0, 3)) {
        console.log(`  #${d.Invoice_Number} | type=${d.InvoiceType} | ${d.InvoiceDateOnly ?? d.InvoiceDate} | ${d.Cust_Name} | ${d.TotalIncludeVATNIS}₪`);
      }
    }
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
