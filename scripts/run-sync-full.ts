// סנכרון מלא — מוחק את הרשומות הישנות, שולף טריות מ-Fireberry עם enrichment + תיאור
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { syncFireberryPurchases } from "../src/lib/fireberry/sync";

async function main() {
  console.log("=== מתחיל סנכרון מלא...");
  const result = await syncFireberryPurchases();
  console.log("✓ הושלם:", result);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
