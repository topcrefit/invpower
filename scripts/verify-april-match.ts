import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { cardcomGetReportAll } from "@/lib/cardcom/client";
import { buildIncomeReportXlsx } from "@/lib/reports/income-excel";
import * as XLSX from "xlsx";
import fs from "node:fs";

async function main() {
  const from = new Date("2026-04-01T00:00:00");
  const to = new Date("2026-04-30T23:59:59");
  const docs = await cardcomGetReportAll(from, to, -1);
  const buf = buildIncomeReportXlsx(docs);
  const outPath = "C:/Users/topcr/Downloads/income_2026-04-01_2026-04-30_FIXED.xlsx";
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath} with ${docs.length} docs`);

  // Read the output back and compare totals to Cardcom export
  const wb = XLSX.readFile(outPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  const totals = aoa[aoa.length - 1];
  console.log("MY totals:", totals);

  // CARDCOM totals from earlier comparison:
  // [ '', '', 'כמות: 418', '', '238,094.95', '0.00', '42,857.05',
  //   '280,952.00', '8,730.00', '0.00', '0.00', '280,852.00', '259,172.00' ]
  console.log("\nCARDCOM totals (from manual export):");
  console.log("  כמות: 418");
  console.log("  חייב במע\"מ: 238,094.95");
  console.log("  לא חייב: 0");
  console.log("  מע\"מ: 42,857.05");
  console.log("  סה\"כ חשבונית: 280,952.00");
  console.log("  מזומן: 8,730");
  console.log("  המחאות: 0");
  console.log("  כרטיס אשראי: 0");
  console.log("  סה\"כ קבלה: 280,852.00");
  console.log("  העברה בנקאית: 259,172.00");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
