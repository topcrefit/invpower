// בדיקה אמיתית של Cardcom Documents/CreateTaxInvoice עם הפרמטרים הנכונים — אבל סכום מזערי
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const creds = await getCardcomCreds();
  if (!creds) throw new Error("no creds");
  console.log("baseUrl:", creds.baseUrl, "terminal:", creds.terminalNumber);

  // body מלא כמו שהקוד שלנו שולח
  const body: Record<string, unknown> = {
    ApiName: creds.apiName,
    ApiPassword: creds.apiPassword,
    InvoiceType: 3,
    InvoiceHead: {
      CustName: "אמאל אבו אלקום",
      CompID: "065753881",
      CustMobilePH: "0505449744",
      Language: "he",
      CoinID: 1,
    },
    InvoiceLines: [
      {
        Description: "תיקון נתוני אשראי",
        Price: 100 / 1.18, // base — מלא בלי עיגול
        Quantity: 1,
      },
    ],
    CustomPay: [
      {
        Description: "העברה בנקאית",
        Sum: 100,
        Asmachta: "99004",
        DateCheque: "2026-04-27",
      },
    ],
  };
  if (creds.terminalNumber) body.TerminalNumber = creds.terminalNumber;

  console.log("\n>>> שולח...");
  console.log(JSON.stringify(body, null, 2));

  const url = `${creds.baseUrl}/api/v11/Documents/CreateTaxInvoice`;
  console.log("\nURL:", url);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log("\n<<< תגובה: status", res.status);
  const text = await res.text();
  console.log(text.slice(0, 2000));

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
