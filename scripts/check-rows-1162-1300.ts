import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { google } from "googleapis";

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "C:/Users/topcr/Downloads/invpower-sheets-411adc54b93a.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = "1R-PdpZF7H05iYB6IjXbYxsVcZnQiGNqMc1Bn5QTS9_c";
  const rows = [1162, 1300];
  for (const r of rows) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `תזרים!A${r}:J${r}`,
    });
    const v = res.data.values?.[0] ?? [];
    console.log(`Row ${r}:`);
    console.log(`  A date=${v[0]}`);
    console.log(`  B valueDate=${v[1]}`);
    console.log(`  C desc=${v[2]}`);
    console.log(`  D ref=${v[3]}`);
    console.log(`  E debit=${v[4]}`);
    console.log(`  F credit=${v[5]}`);
    console.log(`  G extDesc=${v[6]}`);
    console.log(`  H status=${v[7]}`);
    console.log(`  I check=${v[8]}`);
    console.log("");
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
