import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { cardcomGetReport, cardcomGetReportAll } from "@/lib/cardcom/client";

async function main() {
  const from = new Date("2026-02-01T00:00:00");
  const to = new Date("2026-02-28T23:59:59");

  // Test ItemsPerPage=100 explicitly
  console.log("=== Page 1 (PER_PAGE=100) ===");
  const p1 = await cardcomGetReport(from, to, 1, 1, 100);
  console.log(`Got ${p1.length} docs`);
  if (p1.length) {
    console.log(`First: ${p1[0].Invoice_Number} ${p1[0].InvoiceDateOnly}`);
    console.log(`Last:  ${p1[p1.length - 1].Invoice_Number} ${p1[p1.length - 1].InvoiceDateOnly}`);
  }

  console.log("\n=== Page 2 (PER_PAGE=100) ===");
  const p2 = await cardcomGetReport(from, to, 1, 2, 100);
  console.log(`Got ${p2.length} docs`);
  if (p2.length) {
    console.log(`First: ${p2[0].Invoice_Number} ${p2[0].InvoiceDateOnly}`);
    console.log(`Last:  ${p2[p2.length - 1].Invoice_Number} ${p2[p2.length - 1].InvoiceDateOnly}`);
  }

  console.log("\n=== getReportAll (now uses 100) ===");
  const all = await cardcomGetReportAll(from, to, 1);
  console.log(`Total: ${all.length}`);
  // count by day
  const byDay = new Map<string, number>();
  for (const d of all) {
    const dt = String(d.InvoiceDateOnly ?? "").slice(0, 10);
    byDay.set(dt, (byDay.get(dt) ?? 0) + 1);
  }
  const days = Array.from(byDay.entries()).sort();
  console.log(`Distinct days: ${days.length}`);
  console.log(`First day: ${days[0]?.[0]}, Last day: ${days[days.length - 1]?.[0]}`);
  // Find min and max invoice numbers
  let minNum = Infinity, maxNum = -Infinity;
  for (const d of all) {
    const n = Number(d.Invoice_Number);
    if (n < minNum) minNum = n;
    if (n > maxNum) maxNum = n;
  }
  console.log(`Invoice numbers: ${minNum} → ${maxNum} (range: ${maxNum - minNum + 1})`);
  // Check uniqueness
  const ids = new Set(all.map((d) => d.Invoice_Number));
  console.log(`Unique invoices: ${ids.size} (vs ${all.length} total — ${all.length - ids.size} duplicates)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
