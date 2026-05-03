import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { cardcomGetReportAll } from "@/lib/cardcom/client";

async function main() {
  const from = new Date("2026-04-01T00:00:00");
  const to = new Date("2026-04-30T23:59:59");
  const all = await cardcomGetReportAll(from, to, -1);

  // Sum TotalCustomeTransactionNIS by InvoiceType to find where the 12,950 comes from
  const byType = new Map<number, { count: number; ct: number; cash: number; cheques: number; credit: number; ricipient: number; total: number }>();
  for (const d of all) {
    const t = Number(d.InvoiceType);
    const cur = byType.get(t) ?? { count: 0, ct: 0, cash: 0, cheques: 0, credit: 0, ricipient: 0, total: 0 };
    cur.count += 1;
    cur.ct += Number(d.TotalCustomeTransactionNIS ?? 0);
    cur.cash += Number(d.TotalChashNIS ?? 0);
    cur.cheques += Number(d.TotalChequesNIS ?? 0);
    cur.credit += Number(d.TotalCreditCardNIS ?? 0);
    cur.ricipient += Number(d.TotalRicipientNIS ?? 0);
    cur.total += Number(d.TotalIncludeVATNIS ?? 0);
    byType.set(t, cur);
  }
  console.log("Type | Count | CustomTrans | Cash | Cheques | Credit | Ricipient | TotalInv");
  let allCt = 0, allRic = 0, allCash = 0, allCh = 0, allCr = 0;
  for (const [t, v] of byType) {
    console.log(`${t} | ${v.count} | ${v.ct.toFixed(2)} | ${v.cash.toFixed(2)} | ${v.cheques.toFixed(2)} | ${v.credit.toFixed(2)} | ${v.ricipient.toFixed(2)} | ${v.total.toFixed(2)}`);
    allCt += v.ct;
    allRic += v.ricipient;
    allCash += v.cash;
    allCh += v.cheques;
    allCr += v.credit;
  }
  console.log(`\nGRAND: CustomTrans=${allCt.toFixed(2)} Cash=${allCash.toFixed(2)} Cheques=${allCh.toFixed(2)} Credit=${allCr.toFixed(2)} Ricipient=${allRic.toFixed(2)}`);
  console.log(`Cash+Cheques+Credit+CustomTrans = ${(allCash + allCh + allCr + allCt).toFixed(2)} (expected = Ricipient)`);

  // Find docs where TotalRicipientNIS != sum of all payment methods
  console.log("\n=== Docs where Ricipient != Cash+Ch+Credit+CT ===");
  let mismatchCount = 0;
  let mismatchSum = 0;
  for (const d of all) {
    const cash = Number(d.TotalChashNIS ?? 0);
    const ch = Number(d.TotalChequesNIS ?? 0);
    const cr = Number(d.TotalCreditCardNIS ?? 0);
    const ct = Number(d.TotalCustomeTransactionNIS ?? 0);
    const ric = Number(d.TotalRicipientNIS ?? 0);
    const sum = cash + ch + cr + ct;
    const diff = ric - sum;
    if (Math.abs(diff) > 0.01) {
      mismatchCount++;
      mismatchSum += diff;
      if (mismatchCount <= 10) {
        console.log(`  #${d.Invoice_Number} type=${d.InvoiceType} ric=${ric} sum=${sum} diff=${diff}`);
      }
    }
  }
  console.log(`\nTotal mismatched docs: ${mismatchCount}, sum of diffs: ${mismatchSum.toFixed(2)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
