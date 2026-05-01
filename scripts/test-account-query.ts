// בדיקת שאילתת Account ישירות
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { getFireberryCreds } from "../src/lib/settings/store";

async function main() {
  const creds = await getFireberryCreds();
  if (!creds) throw new Error("no creds");
  console.log("baseUrl:", creds.baseUrl);

  const accountId = "fdc9f5ca-7a37-414f-b759-610cc843d7e9"; // פאטמה

  // נסיון 1: כמו בקוד הנוכחי — IN
  console.log("\n=== נסיון 1: query IN ===");
  const r1 = await fetch(`${creds.baseUrl}/api/query`, {
    method: "POST",
    headers: {
      tokenid: creds.token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      objecttype: 1,
      page_size: 10,
      page_number: 1,
      fields: "accountid,idnumber,phone,mobilephone,telephone1",
      query: `(accountid IN ('${accountId}'))`,
    }),
  });
  const j1 = await r1.json();
  console.log("status:", r1.status);
  console.log(JSON.stringify(j1, null, 2).slice(0, 1500));

  // נסיון 2: query =
  console.log("\n=== נסיון 2: query = ===");
  const r2 = await fetch(`${creds.baseUrl}/api/query`, {
    method: "POST",
    headers: {
      tokenid: creds.token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      objecttype: 1,
      page_size: 10,
      page_number: 1,
      fields: "*",
      query: `(accountid = '${accountId}')`,
    }),
  });
  const j2 = await r2.json();
  console.log("status:", r2.status);
  const data = j2.data?.Data ?? j2.data?.Records ?? [];
  if (data.length > 0) {
    const acc = data[0];
    console.log("\nשדות לא ריקים ב-Account:");
    for (const k of Object.keys(acc)) {
      const v = acc[k];
      if (v != null && v !== "" && v !== 0) {
        console.log(`  ${k}: ${typeof v === "string" ? v.slice(0, 80) : v}`);
      }
    }
  } else {
    console.log("ריק:", JSON.stringify(j2).slice(0, 500));
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
