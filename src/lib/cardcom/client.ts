import { getCardcomCreds } from "@/lib/settings/store";

/* ================================================================
   Cardcom v11 — Invoice/CreateTaxInvoice + Documents/GetReport
   ================================================================ */

export type CreateTaxInvoiceInput = {
  customerName: string;
  customerTaxId?: string | null;
  customerPhone?: string | null;
  fireberryAccountId?: string | null; // → AccountForeignKey
  productDescription: string; // שם מוצר מ-Fireberry → InvoiceLines[0].Description
  amount: number; // סכום מהבנק
  asmachta?: string | null; // אסמכתא בנקאית
  bankDate: Date; // תאריך הבנק → CustomPay[0].DateCheque
};

export type CreateTaxInvoiceResult = {
  responseCode: number;
  description?: string;
  invoiceNumber?: string;
  invoiceLink?: string;
  accountId?: string;
  raw: unknown;
};

const PAYMENT_DESCRIPTION_BANK_TRANSFER = "העברה בנקאית"; // חובה — ערך מדויק

function ymdHyphen(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * יצירת חשבונית מס/קבלה ב-Cardcom — InvoiceType=3.
 * אמצעי תשלום: העברה בנקאית בלבד.
 */
export async function cardcomCreateTaxInvoice(
  input: CreateTaxInvoiceInput
): Promise<CreateTaxInvoiceResult> {
  const creds = await getCardcomCreds();
  if (!creds) throw new Error("Cardcom credentials not configured");

  const body: Record<string, unknown> = {
    ApiName: creds.apiName,
    ApiPassword: creds.apiPassword,
    InvoiceType: 3, // חשבונית מס/קבלה
    InvoiceHead: {
      CustName: input.customerName,
      CompID: input.customerTaxId ?? undefined,
      CustMobilePH: input.customerPhone ?? undefined,
      AccountForeignKey: input.fireberryAccountId ?? undefined,
      Language: "he",
      CoinID: 1,
      // ExtIsVatFree לא נשלח — ברירת המחדל ב-Cardcom היא חייב במע״מ
    },
    InvoiceLines: [
      {
        Description: input.productDescription || "תשלום",
        Price: input.amount, // מספר, כולל מע"מ
        Quantity: 1,
        IsPriceIncludeVAT: true,
      },
    ],
    // CustomLines (לא CustomPay!) — חובה בדיוק לפי התיעוד
    // ⚠ אסור לשלוח Description בעברית — שובר את סיווג התשלום ל"הכנסה לבירור"
    // Cardcom מסווג אוטומטית "העברה בנקאית" כשהבלוק הזה מולא
    CustomLines: [
      {
        Sum: input.amount, // מספר, זהה ל-Price
        asmacta: input.asmachta ?? "", // אותיות קטנות!
        TranDate: ymdHyphen(input.bankDate), // YYYY-MM-DD בלבד
      },
    ],
  };
  if (creds.terminalNumber) body.TerminalNumber = creds.terminalNumber;

  const url = `${creds.baseUrl}/api/v11/Documents/CreateTaxInvoice`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  const responseCode = Number(
    (json.ResponseCode as number | undefined) ??
      (json.responseCode as number | undefined) ??
      -1
  );
  const description =
    (json.Description as string | undefined) ??
    (json.description as string | undefined);

  return {
    responseCode,
    description,
    invoiceNumber: pickStr(json, "InvoiceNumber", "invoiceNumber"),
    invoiceLink: pickStr(json, "InvoiceLink", "invoiceLink", "DocumentLink"),
    accountId: pickStr(json, "AccountID", "accountId", "AccountId"),
    raw: json,
  };
}

/**
 * שליפת חשבוניות מ-Cardcom: GetReport (DocType=1 = חשבונית מס/קבלה).
 */
export async function cardcomGetReport(
  fromDate: Date,
  toDate: Date,
  docType: -1 | 1 | 305 = 1
) {
  const creds = await getCardcomCreds();
  if (!creds) throw new Error("Cardcom credentials not configured");

  const body: Record<string, unknown> = {
    ApiName: creds.apiName,
    ApiPassword: creds.apiPassword,
    FromDate: ymdHyphen(fromDate), // YYYY-MM-DD (with hyphens — Cardcom requires this despite the misleading error message)
    ToDate: ymdHyphen(toDate),
    DocType: docType,
    CoinId: 1,
    OpenClose: 0,
    ItemsPerPage: 500,
    PageNumber: 1,
  };
  if (creds.terminalNumber) body.TerminalNumber = creds.terminalNumber;

  const url = `${creds.baseUrl}/api/v11/Documents/GetReport`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (Number(json.ResponseCode) !== 0) {
    throw new Error(`Cardcom GetReport: ${json.Description ?? "unknown error"}`);
  }
  const list = (json.Documents as unknown[] | undefined) ?? [];
  return list as Array<Record<string, unknown>>;
}

/**
 * הורדת PDF של חשבונית מ-URL שהחזיר Cardcom (InvoiceLink).
 */
export async function cardcomDownloadPdfFromUrl(invoiceLink: string): Promise<Buffer> {
  const res = await fetch(invoiceLink);
  if (!res.ok) {
    throw new Error(`PDF download failed: HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * הורדת PDF של חשבונית לפי מספר חשבונית — דרך GetDocumentPDF.aspx.
 * זה ה-endpoint שמתעד הקבלן ועובד.
 */
export async function cardcomDownloadPdfByNumber(
  invoiceNumber: string | number,
  documentType: number = 1
): Promise<Buffer> {
  const creds = await getCardcomCreds();
  if (!creds) throw new Error("Cardcom credentials not configured");
  const url =
    `${creds.baseUrl}/interface/GetDocumentPDF.aspx` +
    `?UserName=${encodeURIComponent(creds.apiName)}` +
    `&UserPassword=${encodeURIComponent(creds.apiPassword)}` +
    `&DocumentNumber=${encodeURIComponent(String(invoiceNumber))}` +
    `&DocumentType=${documentType}` +
    `&IsOriginal=True`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`PDF download failed: HTTP ${res.status}`);
  }
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);
  // ולידציה — חייב להתחיל ב-%PDF
  if (buf.length < 100 || !buf.toString("utf8", 0, 4).startsWith("%PDF")) {
    throw new Error(
      `Invalid PDF response from Cardcom (${buf.length} bytes, starts with "${buf.toString("utf8", 0, 20)}")`
    );
  }
  return buf;
}

function pickStr(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}
