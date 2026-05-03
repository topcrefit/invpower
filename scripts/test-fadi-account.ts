import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { fireberryEnrichWithAccount } from "@/lib/fireberry/client";

async function main() {
  const accountIds = [
    { id: "6d271566-b75f-4648-acf8-0c4b43680813", name: "פאדי אבו אל חוף" },
    { id: "d05f678b-8b24-48ea-9e9c-8129cc5a9878", name: "פאדי עבד אל חי" },
    { id: "7ce3470e-50a7-4816-9a87-c534511fb2e0", name: "פאדי חאזן" },
  ];
  const fakeRecords = accountIds.map((a) => ({
    accountproductid: "test",
    accountid: a.id,
    accountname: a.name,
  }));
  const enriched = await fireberryEnrichWithAccount(fakeRecords as any);
  for (const r of enriched) {
    console.log(`${r.accountname}:`);
    console.log(`  idnumber=${r.idnumber}`);
    console.log(`  mobilephone=${r.mobilephone}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
