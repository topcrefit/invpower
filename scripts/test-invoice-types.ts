import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const c = await getCardcomCreds();
  if (!c) throw new Error("no creds");

  for (const InvoiceType of [1, 2, 3, 4, 5]) {
    const body = {
      ApiName: c.apiName,
      ApiPassword: c.apiPassword,
      TerminalNumber: c.terminalNumber,
      InvoiceType,
      InvoiceHead: { CustName: "TEST", Language: "he", CoinID: 1 },
      InvoiceLines: [{ Description: "test", Price: 1, Quantity: 1 }],
    };
    const res = await fetch(`${c.baseUrl}/api/v11/Documents/CreateTaxInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const t = await res.text();
    console.log(`InvoiceType=${InvoiceType}: ${res.status} | ${t.slice(0, 200)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
