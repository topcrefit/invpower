import * as XLSX from "xlsx";

const cardcomPath = "C:/Users/topcr/Downloads/מסמכים (6).xlsx";
const myPath = "C:/Users/topcr/Downloads/income_2026-04-01_2026-04-30 (1).xlsx";

function readReport(path: string, label: string) {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  console.log(`\n=== ${label} (${path.split("/").pop()}) ===`);
  console.log(`Total rows (with headers + totals): ${aoa.length}`);
  // Headers in row 1+2 (0-indexed: 0,1)
  // Data from row index 2 to length-2 (last is totals)
  const headers1 = aoa[0];
  const headers2 = aoa[1];
  console.log("Header row 1:", headers1);
  console.log("Header row 2:", headers2);
  const dataRows = aoa.slice(2, -1);
  const totalsRow = aoa[aoa.length - 1];
  console.log(`Data rows: ${dataRows.length}`);
  console.log("Totals row:", totalsRow);
  // Get unique invoice numbers (col index 2 = "מס מסמך")
  const invoiceNumbers = new Set<string>();
  for (const r of dataRows) {
    const num = String(r[2] ?? "").trim();
    if (num) invoiceNumbers.add(num);
  }
  // Get min/max date (col 0)
  const dates = dataRows.map((r) => String(r[0] ?? "")).filter(Boolean).sort();
  console.log(`Unique invoice numbers: ${invoiceNumbers.size}`);
  console.log(`Date range in data: ${dates[0]} → ${dates[dates.length - 1]}`);
  return { dataRows, totalsRow, invoiceNumbers };
}

const cardcom = readReport(cardcomPath, "CARDCOM (manual)");
const mine = readReport(myPath, "MY SYSTEM");

console.log("\n=== DIFFERENCES ===");
console.log(`Row count diff: cardcom=${cardcom.dataRows.length} vs mine=${mine.dataRows.length} (diff: ${cardcom.dataRows.length - mine.dataRows.length})`);

// Find invoice numbers in cardcom but not in mine
const onlyInCardcom: string[] = [];
for (const n of cardcom.invoiceNumbers) {
  if (!mine.invoiceNumbers.has(n)) onlyInCardcom.push(n);
}
const onlyInMine: string[] = [];
for (const n of mine.invoiceNumbers) {
  if (!cardcom.invoiceNumbers.has(n)) onlyInMine.push(n);
}
console.log(`\nInvoices in CARDCOM but not in mine: ${onlyInCardcom.length}`);
if (onlyInCardcom.length > 0) {
  console.log("  Sample:", onlyInCardcom.slice(0, 20));
  // Show full row from cardcom for first 5
  console.log("  Full rows:");
  for (const num of onlyInCardcom.slice(0, 10)) {
    const row = cardcom.dataRows.find((r) => String(r[2] ?? "").trim() === num);
    console.log(`    ${num}:`, row);
  }
}
console.log(`\nInvoices in mine but not in CARDCOM: ${onlyInMine.length}`);
if (onlyInMine.length > 0) {
  console.log("  Sample:", onlyInMine.slice(0, 20));
  for (const num of onlyInMine.slice(0, 10)) {
    const row = mine.dataRows.find((r) => String(r[2] ?? "").trim() === num);
    console.log(`    ${num}:`, row);
  }
}

// Compare totals
console.log("\n=== TOTALS COMPARISON ===");
console.log("CARDCOM totals:", cardcom.totalsRow);
console.log("MINE totals:   ", mine.totalsRow);
