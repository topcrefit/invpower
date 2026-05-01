import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const c = await getCardcomCreds();
  if (!c) throw new Error("no creds");
  console.log("apiName:", c.apiName, "terminal:", c.terminalNumber);

  const payload = {
    ApiName: c.apiName,
    ApiPassword: c.apiPassword,
    TerminalNumber: Number(c.terminalNumber),
    Operation: "2",
    Document: {
      DocumentTypeToCreate: "TaxInvoiceAndReceipt",
      Name: "אמאל אבו אלקום",
      TaxId: "065753881",
      Mobile: "0505449744",
      Language: "he",
      IsVatFree: false,
      IsAutoCreateUpdateAccount: false,
      IsSendByEmail: false,
      IsPriceInclusiveVAT: true,
      Products: [
        {
          Description: "תיקון נתוני אשראי",
          UnitCost: 100,
          Quantity: 1,
        },
      ],
      AdvancedDefinition: { IsLandingPagePayment: false },
    },
    CustomPay: [
      {
        Description: "העברה בנקאית",
        Sum: 100,
        IsRefund: false,
        Asmachta: "99004",
        TranDate: "2026-04-27",
      },
    ],
  };

  const url = `${c.baseUrl}/api/v11/Documents/CreateDocument`;
  console.log("URL:", url);
  console.log("\n>>> Payload:");
  const printable = { ...payload, ApiPassword: "***" };
  console.log(JSON.stringify(printable, null, 2));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log("\n<<< status:", res.status);
  const text = await res.text();
  console.log(text.slice(0, 2000));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
