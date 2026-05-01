import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const c = await getCardcomCreds();
  if (!c) throw new Error("no creds");

  // ננסה כמה גרסאות עם שינויים קטנים
  const variations = [
    {
      label: "v1: Price=100, no VAT flag, CustomPay Sum=100",
      lines: [{ Description: "test", Price: 100, Quantity: 1 }],
      pay: 100,
    },
    {
      label: "v2: Price=100 IsPriceIncludeVAT=true, Sum=100",
      lines: [{ Description: "test", Price: 100, Quantity: 1, IsPriceIncludeVAT: true }],
      pay: 100,
    },
    {
      label: "v3: Price=100 (excl VAT), Sum=118",
      lines: [{ Description: "test", Price: 100, Quantity: 1 }],
      pay: 118,
    },
    {
      label: "v4: Price=84.7458 (precise base), Sum=100",
      lines: [{ Description: "test", Price: 84.7458, Quantity: 1 }],
      pay: 100,
    },
  ];

  for (const v of variations) {
    console.log(`\n=== ${v.label} ===`);
    const payload: Record<string, unknown> = {
      ApiName: c.apiName,
      ApiPassword: c.apiPassword,
      TerminalNumber: Number(c.terminalNumber),
      InvoiceType: 3,
      InvoiceHead: { CustName: "TEST", Language: "he", CoinID: 1 },
      InvoiceLines: v.lines,
      CustomPay: [
        {
          Description: "העברה בנקאית",
          Sum: v.pay,
          Asmachta: "TEST",
          DateCheque: "2026-04-27",
        },
      ],
    };
    const res = await fetch(`${c.baseUrl}/api/v11/Documents/CreateTaxInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const t = await res.text();
    const j = JSON.parse(t);
    console.log(`  ResponseCode: ${j.ResponseCode}, ${j.Description?.slice(0, 80)}`);
    if (j.InvoiceNumber) console.log(`  ✅ InvoiceNumber: ${j.InvoiceNumber}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
