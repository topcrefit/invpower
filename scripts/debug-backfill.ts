import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { getFireberryCreds } from "@/lib/settings/store";

async function main() {
  const creds = await getFireberryCreds();
  if (!creds) throw new Error("no creds");
  const headers = {
    tokenid: creds.tokenId,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const accounts = [
    { id: "6d271566-b75f-4648-acf8-0c4b43680813", name: "פאדי אבו אל חוף" },
    { id: "d05f678b-8b24-48ea-9e9c-8129cc5a9878", name: "פאדי עבד אל חי" },
    { id: "7ce3470e-50a7-4816-9a87-c534511fb2e0", name: "פאדי חאזן" },
  ];

  for (const a of accounts) {
    const body = {
      objecttype: 1,
      page_size: 1,
      page_number: 1,
      fields: "*",
      query: `(accountid = '${a.id}')`,
    };
    const res = await fetch(`${creds.baseUrl}/api/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    console.log(`\n=== ${a.name} (${a.id}) ===`);
    console.log(`HTTP ${res.status}`);
    const j = await res.json().catch((e) => ({ error: e }));
    console.log("Response:", JSON.stringify(j, null, 2).slice(0, 500));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
