import * as XLSX from "xlsx";

const path = "C:/Users/topcr/Downloads/הכנסות פברואר (1).xlsx";
const wb = XLSX.readFile(path);
console.log("Sheets:", wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws["!ref"] ?? "";
  console.log(`\n=== Sheet: ${name} | range=${ref} ===`);
  // Read as array of arrays so we see exact layout including merged headers
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  console.log(`Rows: ${aoa.length}`);
  // Print first 6 rows to see headers and a few data rows
  for (let i = 0; i < Math.min(8, aoa.length); i++) {
    console.log(`  R${i + 1}:`, aoa[i]);
  }
  // Also count distinct first-column values for sense of size
  if (aoa.length > 8) {
    console.log(`  ... (${aoa.length - 8} more rows)`);
    console.log(`  Last row:`, aoa[aoa.length - 1]);
  }
}
