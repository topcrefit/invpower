import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { cardcomGetReportAll } from "@/lib/cardcom/client";

async function main() {
  const from = new Date("2026-04-01T00:00:00");
  const to = new Date("2026-04-30T23:59:59");
  const all = await cardcomGetReportAll(from, to, -1);
  console.log(`Total docs: ${all.length}`);

  // Distribution by InvoiceType
  const byType = new Map<number, number>();
  for (const d of all) {
    const t = Number(d.InvoiceType);
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  console.log("\nBy InvoiceType:");
  for (const [t, c] of byType) console.log(`  Type ${t}: ${c} docs`);

  // Show all keys + a sample of each type to see if Cardcom returns a Hebrew name
  const seen = new Set<number>();
  for (const d of all) {
    const t = Number(d.InvoiceType);
    if (seen.has(t)) continue;
    seen.add(t);
    console.log(`\n--- Sample for Type ${t} (#${d.Invoice_Number}) ---`);
    console.log("Keys:", Object.keys(d).filter(k => /name|type|doc/i.test(k)));
    console.log("Full:", JSON.stringify(d, null, 2).slice(0, 500));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
