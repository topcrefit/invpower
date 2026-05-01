import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { getCardcomCreds } from "../src/lib/settings/store";

async function main() {
  const c = await getCardcomCreds();
  if (!c) throw new Error("no creds");

  // GetReport עם פירוט מלא של חשבונית 51057 (נאג'י חאמד)
  const body = {
    ApiName: c.apiName,
    ApiPassword: c.apiPassword,
    TerminalNumber: Number(c.terminalNumber),
    FromDateYYYYMMDD: "20260430",
    ToDateYYYYMMDD: "20260430",
    DocType: 3,
    PageNumber: 1,
    ItemsPerPage: 5,
  };
  const res = await fetch(`${c.baseUrl}/api/v11/Documents/GetReport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (j.Documents && j.Documents.length > 0) {
    const doc = j.Documents[0];
    console.log("=== חשבונית מלאה:");
    console.log(JSON.stringify(doc, null, 2));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
