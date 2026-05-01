// מציאת קודי picklist של pcfsystemfield147 (חשבונית)
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { getFireberryCreds } from "../src/lib/settings/store";

async function main() {
  const creds = await getFireberryCreds();
  if (!creds) throw new Error("no creds");

  // נסיון 1: שאילתת metadata
  console.log("=== נסיון GET /api/metadata/records/33/fields/pcfsystemfield147");
  const r = await fetch(
    `${creds.baseUrl}/api/metadata/records/33/fields/pcfsystemfield147`,
    {
      method: "GET",
      headers: {
        tokenid: creds.token,
        Accept: "application/json",
      },
    }
  );
  console.log("status:", r.status);
  const j = await r.json();
  console.log(JSON.stringify(j, null, 2).slice(0, 3000));

  // אם לא עבד, נסיון 2: שאילתה לדוגמאות לפי ערכים שונים של השדה
  console.log("\n=== חיפוש רשומות עם status שונים:");
  for (const code of [1, 2, 3, 4, 5]) {
    const res = await fetch(`${creds.baseUrl}/api/query`, {
      method: "POST",
      headers: {
        tokenid: creds.token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        objecttype: 33,
        page_size: 1,
        page_number: 1,
        fields: "accountproductid,pcfsystemfield147,pcfsystemfield147name",
        query: `(pcfsystemfield147 = ${code})`,
      }),
    });
    const jj = await res.json();
    const rec = (jj.data?.Data ?? jj.data?.Records ?? [])[0];
    if (rec) {
      console.log(`  קוד ${code}: ${rec.pcfsystemfield147name}`);
    } else {
      console.log(`  קוד ${code}: (אין רשומות)`);
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
