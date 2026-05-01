// בדיקת חיבור ל-Google Sheet — קריאה בלבד, לא משנה כלום
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });

import { fetchBankSheetRows, findMatchingRow } from "../src/lib/google-sheets/client";

async function main() {
  console.log("Connecting to Google Sheet...");
  const rows = await fetchBankSheetRows();
  console.log(`✓ Found ${rows.length} rows in sheet`);
  console.log("\nFirst 5 rows:");
  for (const r of rows.slice(0, 5)) {
    console.log(
      `  row ${r.rowIndex}: ${r.date} | ref=${r.reference} | amount=${r.amount} | status=${r.status} | ${r.extendedDescription.slice(0, 60)}`
    );
  }

  // בדיקת מציאת שורה: חיים עזרי 300 23/04
  console.log("\nBLOCKING test: Find חיים עזרי 300 on 23/04");
  const match = findMatchingRow(rows, "99009", 300, new Date("2026-04-23"));
  if (match) {
    console.log(`  ✓ Found at row ${match.rowIndex}: status=${match.status}`);
  } else {
    console.log(`  ❌ Not found`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
