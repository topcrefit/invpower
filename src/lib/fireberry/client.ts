import { getFireberryCreds } from "@/lib/settings/store";

/* ================================================================
   Fireberry — api.powerlink.co.il
   Object 33 = Purchase, Object 1 = Account
   ================================================================ */

async function fbCfg() {
  const creds = await getFireberryCreds();
  if (!creds) throw new Error("Fireberry credentials not configured");
  return {
    headers: {
      tokenid: creds.token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    baseUrl: creds.baseUrl,
  };
}

export type FireberryPurchaseRaw = {
  accountproductid: string;
  accountid?: string | null;
  pcfobjectid?: string | null;
  productname?: string | null;
  pcfsystemfield195?: string | null; // ← השדה האמיתי של "תיאור לחשבונית" (pcfInvoiceLinesDescription בתצוגה)
  pcfinvoicelinesdescription?: string | null;
  pcfInvoiceLinesDescription?: string | null;
  price?: number | string | null;
  pcfsystemfield1007?: number | string | null;
  accountname?: string | null;
  idnumber?: string | null;
  phone?: string | null;
  mobilephone?: string | null;
  telephone1?: string | null;
  emailaddress1?: string | null;
  createdon?: string | null;
  modifiedon?: string | null;
  pcfsystemfield147?: number | null;
  pcfsystemfield147name?: string | null;
  pcfsystemfield73?: number | null;
  pcfsystemfield73name?: string | null;
  pcfsystemfield83?: number | null;
  pcfsystemfield83name?: string | null;
  pcfsystemfield885?: number | null;
  pcfsystemfield885name?: string | null;
  [k: string]: unknown;
};

const PURCHASE_FIELDS = [
  "accountproductid",
  "accountid",
  "pcfobjectid",
  "productname",
  "price",
  "pcfsystemfield1007",
  "accountname",
  "idnumber",
  "phone",
  "mobilephone",
  "telephone1",
  "emailaddress1",
  "createdon",
  "modifiedon",
  "pcfsystemfield147",
  "pcfsystemfield147name",
  "pcfsystemfield73",
  "pcfsystemfield73name",
  "pcfsystemfield83",
  "pcfsystemfield83name",
  "pcfsystemfield885",
  "pcfsystemfield885name",
].join(",");

function normalizePicklist(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[׳'"]/g, "").trim();
}

/**
 * שליפת רכישות מ-Fireberry לפי הסינונים הקנוניים:
 *   1. createdon >= '2026-01-01'    (טווח מורחב — כדי לתפוס גם כל ה"נשלח" של חודשים קודמים)
 *   2. price > 0.9                  (מחיר גדול מ 0.9)
 *   3. status = "לא נשלח" OR "נשלח" (שניהם — לזהות גם רשומות שכבר הופקה להן חשבונית)
 *   4. payment = "העברה בנקאית"     (picklist — מסונן בזיכרון)
 */
export async function fireberryFetchPurchases(): Promise<FireberryPurchaseRaw[]> {
  const { headers, baseUrl } = await fbCfg();

  const all: FireberryPurchaseRaw[] = [];
  let pageNumber = 1;
  while (true) {
    const body = {
      objecttype: 33,
      page_size: 500,
      page_number: pageNumber,
      fields: "*",
      sort_by: "createdon",
      sort_type: "desc",
      query: "(createdon >= '2026-01-01')",
    };

    const res = await fetch(`${baseUrl}/api/query`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      data?: {
        Data?: FireberryPurchaseRaw[];
        Records?: FireberryPurchaseRaw[];
        IsLastPage?: boolean;
      };
    };
    if (!res.ok || j.success === false) {
      throw new Error(`Fireberry query failed: ${j.message ?? `HTTP ${res.status}`} | body: ${JSON.stringify(j).slice(0, 300)}`);
    }
    const records = j.data?.Data ?? j.data?.Records ?? [];
    all.push(...records);
    if (records.length < 500 || j.data?.IsLastPage) break;
    pageNumber++;
    if (pageNumber > 20) break;
  }

  // post-filter בזיכרון: payment + price + status ב-"לא נשלח" או "נשלח"
  return all.filter((r) => {
    const status = normalizePicklist(r.pcfsystemfield147name);
    const payment = normalizePicklist(r.pcfsystemfield73name);
    const price = pickPrice(r);
    return (
      (status === "לא נשלח" || status === "נשלח") &&
      payment === "העברה בנקאית" &&
      price != null &&
      price > 0.9
    );
  });
}

/**
 * העשרה: ממלא ת.ז. וטלפון מ-Account עבור רכישות שחסרים בהן.
 */
export async function fireberryEnrichWithAccount(
  records: FireberryPurchaseRaw[]
): Promise<FireberryPurchaseRaw[]> {
  const { headers, baseUrl } = await fbCfg();

  const needIds = new Set<string>();
  for (const r of records) {
    if (r.accountid && (!r.idnumber || !pickPhone(r))) needIds.add(r.accountid);
  }
  if (needIds.size === 0) return records;

  // Fireberry לא תומך ב-IN — שאילתה בודדת לכל accountid (במקביל בקבוצות של 10)
  const accMap = new Map<string, { idnumber?: string | null; phone?: string | null }>();
  const ids = Array.from(needIds);
  const BATCH = 10;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (accountId) => {
        const body = {
          objecttype: 1,
          page_size: 1,
          page_number: 1,
          fields: "*",
          query: `(accountid = '${accountId}')`,
        };
        const res = await fetch(`${baseUrl}/api/query`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const j = (await res.json().catch(() => ({}))) as {
          data?: {
            Data?: Array<Record<string, unknown>>;
            Records?: Array<Record<string, unknown>>;
          };
        };
        const list = j.data?.Data ?? j.data?.Records ?? [];
        return { accountId, account: list[0] };
      })
    );
    for (const { accountId, account } of results) {
      if (!account) continue;
      // ת.ז.: idnumber סטנדרטי, אם לא pcfsystemfield3 (קיים לחלק)
      const idnumber =
        (account.idnumber as string | null | undefined) ??
        (account.pcfsystemfield3 as string | null | undefined) ??
        null;
      // טלפון: לפי סדר עדיפות mobilephone → telephone1 → phone
      const phone =
        (account.mobilephone as string | null | undefined) ??
        (account.telephone1 as string | null | undefined) ??
        (account.phone as string | null | undefined) ??
        null;
      accMap.set(accountId, {
        idnumber: idnumber ? String(idnumber) : null,
        phone: phone ? String(phone) : null,
      });
    }
  }

  return records.map((r) => {
    if (!r.accountid) return r;
    const acc = accMap.get(r.accountid);
    if (!acc) return r;
    return {
      ...r,
      idnumber: r.idnumber || acc.idnumber || null,
      mobilephone: pickPhone(r) || acc.phone || r.mobilephone,
    };
  });
}

export function pickPrice(r: FireberryPurchaseRaw): number | null {
  const p = r.price ?? r.pcfsystemfield1007 ?? null;
  if (p == null) return null;
  const n = typeof p === "number" ? p : Number(String(p).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
export function pickPhone(r: FireberryPurchaseRaw): string | null {
  return (
    r.mobilephone ?? r.phone ?? r.telephone1 ?? null
  );
}

/* ================================================================
   Fireberry — עדכון סטטוס חשבונית ברכישה (object 33)
   pcfsystemfield147: 1 = "נשלח", 2 = "לא נשלח"
   ================================================================ */
export async function fireberryMarkPurchaseInvoiceSent(
  accountProductId: string
): Promise<{ ok: boolean; status: number; message?: string }> {
  const { headers, baseUrl } = await fbCfg();
  const url = `${baseUrl}/api/record/33/${accountProductId}`;
  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      pcfsystemfield147: 1, // "נשלח"
    }),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message: (j.Message as string) ?? (j.message as string) ?? `HTTP ${res.status}`,
    };
  }
  return { ok: true, status: res.status };
}

/* ================================================================
   Fireberry — יצירת חשבונית מס/קבלה (customobject1004)
   האוטומציה הפנימית של Fireberry שולחת ל-Cardcom עם סיווג נכון
   "העברה בנקאית" (לא "קוד 0").
   ================================================================ */
export type FireberryCreateInvoiceInput = {
  customerName: string; // name (שם הלקוח על החשבונית)
  accountId: string; // pcfmainaccount (GUID של תיק הלקוח ב-Fireberry)
  customerTaxId?: string | null; // pcfInvoiceHeadCompID
  customerPhone?: string | null; // pcfInvoiceHeadCustMobilePH
  productDescription: string; // pcfInvoiceLinesDescription
  amount: number; // pcfInvoiceLinesPrice + pcfCustomPay1Sum (כולל מע"מ)
  asmachta?: string | null; // pcfCustomPay1Asmacta
  bankDate: Date; // pcfCustomPay1TranDate (YYYY-MM-DD)
  comments?: string | null; // pcfInvoiceHeadComments
  isVatFree?: boolean; // אם true → 1 (פטור), אחרת 2 (חייב במע"מ)
};

export type FireberryCreateInvoiceResult = {
  ok: boolean;
  recordId?: string; // ה-id של רשומת ה-customobject1004
  docNumber?: string; // מספר חשבונית מ-Cardcom (מתעדכן אסינכרונית)
  pdfUrl?: string;
  message?: string;
  raw?: unknown;
};

const FIREBERRY_INVOICE_OBJECT = "1004"; // customobject1004 (חשבונית מס קבלה)
const FIREBERRY_DOC_API_BASE = "https://api.fireberry.com";

function ymdHyphenLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * יוצר רשומת חשבונית מס/קבלה ב-Fireberry. האוטומציה הפנימית של Fireberry
 * תקרא ל-Cardcom להפיק את המסמך הרשמי. אנחנו מקבלים מיד את ה-recordId,
 * ואחרי כמה שניות מספר החשבונית מתעדכן ב-pcfDocNumber.
 */
export async function fireberryCreateInvoice(
  input: FireberryCreateInvoiceInput
): Promise<FireberryCreateInvoiceResult> {
  const creds = await getFireberryCreds();
  if (!creds) throw new Error("Fireberry credentials not configured");

  const payload: Record<string, unknown> = {
    name: input.customerName,
    pcfmainaccount: input.accountId,
    pcfInvoiceHeadCompID: input.customerTaxId ?? "",
    pcfInvoiceHeadCustMobilePH: input.customerPhone ?? "",
    pcfInvoiceLinesDescription: input.productDescription,
    pcfInvoiceLinesPrice: input.amount,
    pcfCustomPay1Sum: input.amount,
    pcfCustomPay1Asmacta: input.asmachta ?? "",
    pcfCustomPay1TranDate: ymdHyphenLocal(input.bankDate),
    // ⚠ אסור לשלוח pcfCustomPay1Description — זה שובר את הסיווג!
    pcfInvoiceHeadExtIsVatFree: input.isVatFree ? 1 : 2,
    pcfInvoiceHeadSendByEmail: 0, // לא שולחים אימייל אוטומטי
    pcfInvoiceHeadComments: input.comments ?? "",
  };

  const url = `${FIREBERRY_DOC_API_BASE}/api/record/customobject${FIREBERRY_INVOICE_OBJECT}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      tokenid: creds.token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      message: `Non-JSON response from Fireberry: ${text.slice(0, 300)}`,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      message: `Fireberry HTTP ${res.status}: ${(json.Message as string) ?? (json.message as string) ?? text.slice(0, 200)}`,
      raw: json,
    };
  }

  const data = (json.data ?? json.Data) as Record<string, unknown> | undefined;
  const record = (data?.Record ?? data) as Record<string, unknown> | undefined;
  const recordId =
    (record?.customobject1004id as string | undefined) ??
    (record?.invoiceid as string | undefined) ??
    (record?.id as string | undefined) ??
    "";

  if (!recordId) {
    return {
      ok: false,
      message: "Fireberry לא החזיר recordId — החשבונית לא נוצרה",
      raw: json,
    };
  }

  return {
    ok: true,
    recordId,
    raw: json,
  };
}

/**
 * שולף את רשומת ה-customobject1004 כדי לקבל את מספר החשבונית מ-Cardcom (pcfDocNumber).
 * האוטומציה לוקחת כמה שניות. נקרא לזה כמה פעמים עם המתנה.
 */
export async function fireberryFetchInvoiceRecord(
  recordId: string
): Promise<{
  found: boolean;
  docNumber?: string | null;
  pdfUrl?: string | null;
  raw?: Record<string, unknown>;
}> {
  const creds = await getFireberryCreds();
  if (!creds) throw new Error("Fireberry credentials not configured");

  const url = `${FIREBERRY_DOC_API_BASE}/api/record/customobject${FIREBERRY_INVOICE_OBJECT}/${recordId}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      tokenid: creds.token,
      Accept: "application/json",
    },
  });
  if (!res.ok) return { found: false };
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const data = (json.data ?? json.Data) as Record<string, unknown> | undefined;
  const record = (data?.Record ?? data) as Record<string, unknown> | undefined;
  if (!record) return { found: false, raw: json };

  return {
    found: true,
    docNumber:
      (record.pcfDocNumber as string | null | undefined) ??
      (record.pcfdocnumber as string | null | undefined) ??
      null,
    pdfUrl:
      (record.pcfPdfUrl as string | null | undefined) ??
      (record.pcfpdfurl as string | null | undefined) ??
      null,
    raw: record,
  };
}

/**
 * polling של עד timeoutSec שניות עד שהחשבונית מקבלת מספר מ-Cardcom.
 */
export async function fireberryWaitForInvoiceNumber(
  recordId: string,
  timeoutSec = 30
): Promise<{ docNumber?: string; pdfUrl?: string }> {
  const start = Date.now();
  const interval = 3000;
  while (Date.now() - start < timeoutSec * 1000) {
    const r = await fireberryFetchInvoiceRecord(recordId);
    if (r.docNumber) {
      return { docNumber: r.docNumber, pdfUrl: r.pdfUrl ?? undefined };
    }
    await new Promise((res) => setTimeout(res, interval));
  }
  return {}; // נכשל בקבלת מספר חשבונית בזמן
}

/* ================================================================
   קריאה לסקריפט הטריגר של הקבלן — מפעיל את החשבונית בקארדקום
   הסקריפט הזה הוא בעצם ה"כפתור" בממשק של Fireberry.
   ================================================================ */
const BIOCREDIT_INVOICE_TRIGGER_URL =
  "https://monster-studio.net/github//biocredit-invoice-baam.php";

// משתמש קבוע ב-Fireberry שירשם כיוצר החשבונית (אדמין)
const DEFAULT_FIREBERRY_USER_ID = "A9D4319D-E285-443C-BC12-69DAE8C0F196";

/**
 * מפעיל את הסקריפט שיוצר את החשבונית בקארדקום מהרשומה ב-Fireberry.
 * זה מה שקורה בלחיצת "חשבונית מס קבלה | חברה בעמ" בממשק.
 */
export async function fireberryTriggerInvoiceCreation(
  recordId: string,
  options?: { userId?: string; objectType?: string }
): Promise<{ ok: boolean; status: number; body?: string }> {
  const userId = options?.userId ?? DEFAULT_FIREBERRY_USER_ID;
  const objectType = options?.objectType ?? "1004"; // customobject1004
  const url = `${BIOCREDIT_INVOICE_TRIGGER_URL}?createdby=${userId}&objectid=${recordId}&oid=${objectType}`;
  try {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body: text.slice(0, 500) };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: e instanceof Error ? e.message : String(e),
    };
  }
}

/* ================================================================
   Fireberry — העלאת PDF לרשומת customobject1004 (חשבונית)
   POST /api/v2/record/1004/{recordId}/files (multipart/form-data)
   זה מצרף את ה-PDF לרשומת החשבונית עצמה — מופיע אוטומטית בתיק הלקוח
   דרך הקישור ב-pcfmainaccount.
   ================================================================ */
export async function fireberryUploadPdfToInvoiceRecord(
  recordId: string,
  pdf: Buffer,
  fileName: string
): Promise<{ ok: boolean; status: number; body?: string }> {
  const creds = await getFireberryCreds();
  if (!creds) throw new Error("Fireberry credentials not configured");

  const url = `https://api.fireberry.com/api/v2/record/1004/${recordId}/files`;
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([pdf as unknown as BlobPart], { type: "application/pdf" }),
    fileName
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { tokenid: creds.token },
    body: formData,
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: body.slice(0, 300) };
}

/* ================================================================
   Fireberry — Files API: העלאת PDF ל-account
   ================================================================ */
export async function fireberryUploadPdfToAccount(
  accountId: string,
  fileName: string,
  pdf: Buffer
): Promise<{ fileId: string }> {
  const { headers, baseUrl } = await fbCfg();
  const body = {
    objecttype: 1, // account
    objectid: accountId,
    filename: fileName,
    filecontent: pdf.toString("base64"),
  };
  const res = await fetch(`${baseUrl}/api/file`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Fireberry upload failed: ${JSON.stringify(j)}`);
  const fileId =
    (j.fileid as string | undefined) ??
    ((j.data as Record<string, unknown> | undefined)?.fileid as string | undefined) ??
    "";
  return { fileId };
}
