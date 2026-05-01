// בדיקה לפי התיעוד מ-Lovable
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const c = await getCardcomCreds();
  if (!c) throw new Error("no creds");

  const payload = {
    ApiName: c.apiName,
    ApiPassword: c.apiPassword,
    TerminalNumber: Number(c.terminalNumber),
    InvoiceType: 3, // חשבונית מס/קבלה
    InvoiceHead: {
      CustName: "אמאל אבו אלקום",
      CompID: "065753881",
      CustMobilePH: "0505449744",
      Language: "he",
      CoinID: 1,
      SendByEmail: false,
    },
    InvoiceLines: [
      {
        Description: "תיקון נתוני אשראי",
        Price: 100, // כולל מע"מ
        Quantity: 1,
        IsPriceIncludeVAT: true, // ← הסכום כולל מע"מ
      },
    ],
    CustomLines: [ // ← CustomLines, לא CustomPay
      // ⚠ ללא Description! זה שובר את סיווג התשלום
      {
        Sum: 100, // ← מספר, זהה ל-Price
        asmacta: "99004", // ← lowercase
        TranDate: "2026-04-27", // ← YYYY-MM-DD בלבד
      },
    ],
  };

  console.log(">>> Body:");
  console.log(JSON.stringify({ ...payload, ApiPassword: "***" }, null, 2));

  const res = await fetch(`${c.baseUrl}/api/v11/Documents/CreateTaxInvoice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log("\n<<< status:", res.status);
  const text = await res.text();
  console.log(text);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
