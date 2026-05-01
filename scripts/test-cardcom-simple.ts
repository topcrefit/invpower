import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const creds = await getCardcomCreds();
  if (!creds) throw new Error("no creds");

  console.log("Testing creds:");
  console.log("  apiName:", JSON.stringify(creds.apiName), "len:", creds.apiName.length);
  console.log("  apiPassword:", JSON.stringify(creds.apiPassword), "len:", creds.apiPassword.length);
  console.log("  terminal:", creds.terminalNumber);

  // נסה GetReport (פעולה של קריאה — לא מפיקה כלום, מאמתת creds)
  console.log("\n=== נסיון GetReport (auth-only check):");
  const body = {
    ApiName: creds.apiName,
    ApiPassword: creds.apiPassword,
    TerminalNumber: creds.terminalNumber,
    FromDate: "2026-04-01",
    ToDate: "2026-04-02",
    DocType: 1,
  };
  const res = await fetch(`${creds.baseUrl}/api/v11/Documents/GetReport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log("status:", res.status);
  const text = await res.text();
  console.log(text.slice(0, 500));

  // ננסה גם בפורמט שונה — אולי שדות בlowercase
  console.log("\n=== נסיון עם שדות בlowercase:");
  const body2 = {
    apiName: creds.apiName,
    apiPassword: creds.apiPassword,
    terminalNumber: creds.terminalNumber,
    fromDate: "2026-04-01",
    toDate: "2026-04-02",
    docType: 1,
  };
  const res2 = await fetch(`${creds.baseUrl}/api/v11/Documents/GetReport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body2),
  });
  console.log("status:", res2.status);
  const text2 = await res2.text();
  console.log(text2.slice(0, 500));

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
