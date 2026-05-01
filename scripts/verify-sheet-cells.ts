import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: "C:/DEV/INVPOWER/.env.local" });
import { google } from "googleapis";

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: "C:/Users/topcr/Downloads/invpower-sheets-411adc54b93a.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  // Read columns A-J of specific rows
  const rows = [1162, 1196, 1289, 1298];
  for (const r of rows) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: "1R-PdpZF7H05iYB6IjXbYxsVcZnQiGNqMc1Bn5QTS9_c",
      range: `A${r}:J${r}`,
    });
    const v = res.data.values?.[0] ?? [];
    console.log(`Row ${r}: H=${v[7]} | I="${v[8]}" | name=${v[6]?.slice(0, 40)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
