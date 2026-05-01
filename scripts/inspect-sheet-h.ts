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

  // Find sheet name for gid
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets?.find((s) => s.properties?.sheetId === 2353532);
  const sheetName = sheet?.properties?.title;
  console.log("Sheet name:", sheetName);

  const rows = [1162, 1196, 1289, 1298];
  for (const r of rows) {
    // Get cell metadata via spreadsheets.get with ranges + includeGridData
    const m = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: [`${sheetName}!H${r}:I${r}`],
      includeGridData: true,
    });
    const data = m.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values;
    const h = data?.[0];
    const i = data?.[1];
    console.log(
      `Row ${r}: H userEnteredValue=${JSON.stringify(h?.userEnteredValue)} effectiveValue=${JSON.stringify(h?.effectiveValue)} format=${h?.userEnteredFormat?.numberFormat?.type ?? "-"} dataValidation=${JSON.stringify(h?.dataValidation?.condition?.type ?? null)}`
    );
    console.log(
      `        I userEnteredValue=${JSON.stringify(i?.userEnteredValue)} effectiveValue=${JSON.stringify(i?.effectiveValue)}`
    );
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
