import { google } from "googleapis";
import fs from "node:fs";

const SERVICE_ACCOUNT_PATH =
  process.env.GOOGLE_SERVICE_ACCOUNT_PATH ??
  "C:/Users/topcr/Downloads/invpower-sheets-411adc54b93a.json";

// המזהה של ה-Sheet (מתוך ה-URL שהמשתמש שלח)
export const BANK_SHEET_ID = "1R-PdpZF7H05iYB6IjXbYxsVcZnQiGNqMc1Bn5QTS9_c";
export const BANK_SHEET_GID = 2353532;

// שם הגיליון בתוך ה-spreadsheet — נחפש לפי gid
let cachedSheetName: string | null = null;

function getAuth() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error(
      `Google Service Account file not found at ${SERVICE_ACCOUNT_PATH}`
    );
  }
  return new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetName(): Promise<string> {
  if (cachedSheetName) return cachedSheetName;
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: BANK_SHEET_ID });
  const sheet = meta.data.sheets?.find(
    (s) => s.properties?.sheetId === BANK_SHEET_GID
  );
  if (!sheet?.properties?.title) {
    throw new Error(`Sheet with gid ${BANK_SHEET_GID} not found`);
  }
  cachedSheetName = sheet.properties.title;
  return cachedSheetName;
}

export type BankSheetRow = {
  rowIndex: number; // 1-based row number in sheet
  date: string;
  reference: string;
  amount: number;
  extendedDescription: string;
  status: string;
};

/**
 * שולף את כל השורות מהטאב של הבנק.
 * עמודות A-J (תאריך, תאריך ערך, תיאור, אסמכתא, חובה, זכות, תאור מורחב, סטטוס, בדיקה, אישור)
 */
export async function fetchBankSheetRows(): Promise<BankSheetRow[]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = await getSheetName();
  const range = `${sheetName}!A:J`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: BANK_SHEET_ID,
    range,
  });
  const values = res.data.values ?? [];
  const rows: BankSheetRow[] = [];
  // שורה 1+2 הן headers
  for (let i = 2; i < values.length; i++) {
    const r = values[i];
    if (!r || !r[0]) continue;
    rows.push({
      rowIndex: i + 1, // 1-based
      date: String(r[0] ?? ""),
      reference: String(r[3] ?? ""),
      amount: Number(String(r[5] ?? "").replace(/[,\s]/g, "")) || 0,
      extendedDescription: String(r[6] ?? ""),
      status: String(r[7] ?? ""),
    });
  }
  return rows;
}

/**
 * עדכון שורה ב-Sheet: עמודה H (status) = 1, עמודה I (בדיקה) = invoice number.
 */
export async function markRowAsInvoiced(
  rowIndex: number,
  invoiceNumber: string | number
): Promise<{ ok: boolean; message?: string }> {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const sheetName = await getSheetName();
    // עדכון תא H{row} = 1 ועמודה I{row} = invoiceNumber
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: BANK_SHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: [
          {
            range: `${sheetName}!H${rowIndex}`,
            values: [[1]],
          },
          {
            range: `${sheetName}!I${rowIndex}`,
            values: [[`חשבונית ${invoiceNumber}`]],
          },
        ],
      },
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * מצא שורה מתאימה בטבלה לפי תאריך + אסמכתא + סכום.
 */
export function findMatchingRow(
  rows: BankSheetRow[],
  bankRef: string | null,
  amount: number,
  txDate: Date
): BankSheetRow | null {
  // נירמול תאריך לפורמט d/m/yy או dd/mm/yy
  const day = txDate.getDate();
  const month = txDate.getMonth() + 1;
  const yearShort = txDate.getFullYear() % 100;
  const dateVariants = [
    `${day}/${month}/${yearShort}`,
    `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${yearShort}`,
    `${day}/${month}/${txDate.getFullYear()}`,
  ];
  for (const r of rows) {
    if (Math.abs(r.amount - amount) > 0.005) continue;
    if (bankRef && r.reference !== String(bankRef)) continue;
    if (!dateVariants.some((d) => r.date === d || r.date.startsWith(d + " ")))
      continue;
    return r;
  }
  return null;
}
