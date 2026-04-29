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

/**
 * שליפת רכישות מ-Fireberry לטווח תאריכים. תומך ב-pagination.
 */
export async function fireberryFetchPurchases(opts: {
  from: Date;
  to: Date;
}): Promise<FireberryPurchaseRaw[]> {
  const { headers, baseUrl } = await fbCfg();
  const fromStr = opts.from.toISOString();
  const toStr = opts.to.toISOString();

  const all: FireberryPurchaseRaw[] = [];
  let pageNumber = 1;
  while (true) {
    const body = {
      objecttype: 33,
      page_size: 500,
      page_number: pageNumber,
      fields: PURCHASE_FIELDS,
      sort_by: "modifiedon",
      sort_type: "desc",
      query: `(createdon >= '${fromStr}') AND (createdon <= '${toStr}')`,
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
      throw new Error(`Fireberry query failed: ${j.message ?? `HTTP ${res.status}`}`);
    }
    const records = j.data?.Data ?? j.data?.Records ?? [];
    all.push(...records);
    if (records.length < 500 || j.data?.IsLastPage) break;
    pageNumber++;
    if (pageNumber > 50) break;
  }
  return all;
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

  // chunk: 50 per query
  const chunks: string[][] = [];
  const arr = Array.from(needIds);
  for (let i = 0; i < arr.length; i += 50) chunks.push(arr.slice(i, i + 50));

  const accMap = new Map<string, { idnumber?: string | null; phone?: string | null }>();
  for (const ch of chunks) {
    const inList = ch.map((id) => `'${id}'`).join(",");
    const body = {
      objecttype: 1,
      page_size: 500,
      page_number: 1,
      fields: "accountid,idnumber,phone,mobilephone,telephone1",
      query: `(accountid IN (${inList}))`,
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
    for (const a of list) {
      accMap.set(String(a.accountid), {
        idnumber: a.idnumber as string | null,
        phone:
          (a.mobilephone as string | null) ??
          (a.phone as string | null) ??
          (a.telephone1 as string | null) ??
          null,
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
