import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const c = await getCardcomCreds();
  if (!c) throw new Error("no creds");
  const baseHead = { CustName: "TEST", Language: "he", CoinID: 1 };
  const baseLines = [{ Description: "test", Price: 100, Quantity: 1 }];
  const auth = {
    ApiName: c.apiName,
    ApiPassword: c.apiPassword,
    TerminalNumber: Number(c.terminalNumber),
  };
  const variations: Array<{ label: string; body: Record<string, unknown> }> = [
    // נקיים: Price 100 (base) + VAT 18 = 118 total. CustomPay 118.
    { label: "T=3 base=100 Sum=118 (clean math)", body: { ...auth, InvoiceType: 3, InvoiceHead: baseHead, InvoiceLines: [{ Description: "test", Price: 100, Quantity: 1 }], CustomPay: [{ Description: "BankTransfer", Sum: 118 }] } },
    { label: "T=1 base=100 Sum=118 (clean math)", body: { ...auth, InvoiceType: 1, InvoiceHead: baseHead, InvoiceLines: [{ Description: "test", Price: 100, Quantity: 1 }], CustomPay: [{ Description: "BankTransfer", Sum: 118 }] } },
    // עם IsPriceIncludeVAT
    { label: "T=3 Price=118 IsPriceIncludeVAT Sum=118", body: { ...auth, InvoiceType: 3, InvoiceHead: baseHead, InvoiceLines: [{ Description: "test", Price: 118, Quantity: 1, IsPriceIncludeVAT: true }], CustomPay: [{ Description: "BankTransfer", Sum: 118 }] } },
    { label: "T=1 Price=118 IsPriceIncludeVAT Sum=118", body: { ...auth, InvoiceType: 1, InvoiceHead: baseHead, InvoiceLines: [{ Description: "test", Price: 118, Quantity: 1, IsPriceIncludeVAT: true }], CustomPay: [{ Description: "BankTransfer", Sum: 118 }] } },
  ];
  for (const v of variations) {
    const res = await fetch(
      `${c.baseUrl}/api/v11/Documents/CreateTaxInvoice`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v.body) }
    );
    const t = await res.text();
    const j = JSON.parse(t);
    const note = j.InvoiceNumber ? ` ✅ #${j.InvoiceNumber}` : "";
    console.log(`${v.label}: ${j.ResponseCode} | ${j.Description?.slice(0, 100)}${note}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
