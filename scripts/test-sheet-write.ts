// בדיקת כתיבה: נעדכן שורה 1196 (חיים עזרי 51067) עם status=1 ו-invoice number
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { markRowAsInvoiced } from "../src/lib/google-sheets/client";

async function main() {
  console.log("Updating row 1196 (חיים עזרי) with invoice 51067...");
  const r = await markRowAsInvoiced(1196, 51067);
  console.log("Result:", r);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
