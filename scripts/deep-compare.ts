import * as XLSX from "xlsx";

const cardcomPath = "C:/Users/topcr/Downloads/מסמכים (6).xlsx";
const myPath = "C:/Users/topcr/Downloads/income_2026-04-01_2026-04-30 (2).xlsx";

function read(path: string) {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  return { wb, ws, aoa };
}

const c = read(cardcomPath);
const m = read(myPath);

console.log("=== HEADERS ===");
console.log("Cardcom row 1:", JSON.stringify(c.aoa[0]));
console.log("Mine row 1:   ", JSON.stringify(m.aoa[0]));
console.log("\nCardcom row 2:", JSON.stringify(c.aoa[1]));
console.log("Mine row 2:   ", JSON.stringify(m.aoa[1]));

console.log("\n=== ROW COUNTS ===");
console.log(`Cardcom: ${c.aoa.length} (data rows: ${c.aoa.length - 3})`);
console.log(`Mine:    ${m.aoa.length} (data rows: ${m.aoa.length - 3})`);

console.log("\n=== TOTALS ROW ===");
console.log("Cardcom:", JSON.stringify(c.aoa[c.aoa.length - 1]));
console.log("Mine:   ", JSON.stringify(m.aoa[m.aoa.length - 1]));

// Build map of rows by invoice number for both
function rowMap(aoa: any[][]) {
  const map = new Map<string, any[]>();
  for (let i = 2; i < aoa.length - 1; i++) {
    const r = aoa[i];
    const num = String(r[2] ?? "").trim();
    if (num) map.set(num, r);
  }
  return map;
}
const cMap = rowMap(c.aoa);
const mMap = rowMap(m.aoa);

console.log(`\nCardcom unique invoice numbers: ${cMap.size}`);
console.log(`Mine unique invoice numbers: ${mMap.size}`);

// Cardcom has 4 duplicates (414 unique vs 418 rows). Find them
const cByNum = new Map<string, number>();
for (let i = 2; i < c.aoa.length - 1; i++) {
  const num = String(c.aoa[i][2] ?? "").trim();
  cByNum.set(num, (cByNum.get(num) ?? 0) + 1);
}
const dups = Array.from(cByNum.entries()).filter(([_, n]) => n > 1);
console.log(`\nCardcom duplicates (same invoice number, multiple rows):`, dups);

// Find row-level differences for first 5 invoices
console.log("\n=== Sample diffs ===");
let diffCount = 0;
for (const [num, mRow] of mMap) {
  const cRow = cMap.get(num);
  if (!cRow) continue;
  // Compare each numeric column
  const cols = [4, 5, 6, 7, 8, 9, 10, 11, 12]; // numeric cols
  for (const col of cols) {
    const cVal = Number(cRow[col] ?? 0);
    const mVal = Number(mRow[col] ?? 0);
    if (Math.abs(cVal - mVal) > 0.01) {
      diffCount++;
      if (diffCount <= 20) {
        console.log(`  #${num} col${col}: cardcom=${cVal} mine=${mVal} diff=${(cVal - mVal).toFixed(2)}`);
        console.log(`    cardcom row: ${JSON.stringify(cRow)}`);
        console.log(`    mine row:    ${JSON.stringify(mRow)}`);
        console.log("");
      }
    }
  }
}
console.log(`\nTotal cell diffs: ${diffCount}`);
