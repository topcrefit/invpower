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
    InvoiceType: 3,
    InvoiceHead: {
      CustName: "אמאל אבו אלקום",
      CompID: "065753881",
      CustAddresLine1: "",
      CustCity: "",
      SendByEmail: false,
      Email: "",
      CustMobilePH: "0505449744",
      Language: "he",
      ExtIsVatFree: false,
      Comments: "",
    },
    InvoiceLines: [
      {
        Description: "תיקון נתוני אשראי",
        Price: 100,
        Quantity: 1,
        ProductID: "",
        IsPriceIncludeVAT: true,
      },
    ],
    CustomLines: [
      {
        TransactionID: 0,
        TranDate: "2026-04-27",
        Description: "העברה בנקאית",
        asmacta: "99004",
        Sum: 100,
      },
    ],
  };

  const url = `${c.baseUrl}/api/v11/Documents/CreateTaxInvoice`;
  console.log(">>> URL:", url);
  console.log(">>> Body:", JSON.stringify({ ...payload, ApiPassword: "***" }, null, 2));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log("\n<<< status:", res.status);
  const text = await res.text();
  console.log(text.slice(0, 1500));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
