/**
 * Backfill: ממלא ת.ז./טלפון ברשומות Fireberry שחסרים בהן,
 * ע"י קריאה ישירה לטבלת Account (object 1) לפי accountId.
 *
 * זה רץ אחרי סנכרון רגיל ותופס מקרים שבהם ה-list API לא החזיר את הפרטים
 * וגם ה-enrichment שלא רץ או נכשל.
 */
import { db } from "@/lib/db/client";
import { fireberryPurchases } from "@/lib/db/schema";
import { eq, isNull, or, and, isNotNull } from "drizzle-orm";

async function fbCfg() {
  const { getFireberryCreds } = await import("@/lib/settings/store");
  const creds = await getFireberryCreds();
  if (!creds) throw new Error("Fireberry credentials not configured");
  return {
    headers: {
      tokenid: creds.token,
      "Content-Type": "application/json",
      Accept: "application/json",
    } as Record<string, string>,
    baseUrl: creds.baseUrl,
  };
}

export async function backfillFireberryAccountInfo(): Promise<{
  candidates: number;
  updated: number;
  failed: number;
}> {
  const { headers, baseUrl } = await fbCfg();

  // רשומות שחסרים בהן ת.ז. או טלפון אבל יש להן accountId
  const candidates = await db
    .select()
    .from(fireberryPurchases)
    .where(
      and(
        isNotNull(fireberryPurchases.accountId),
        or(
          isNull(fireberryPurchases.customerTaxId),
          isNull(fireberryPurchases.customerPhone)
        )
      )
    );

  if (candidates.length === 0) {
    return { candidates: 0, updated: 0, failed: 0 };
  }

  // קיבוץ לפי accountId — חוסך קריאות מיותרות לאותו לקוח
  const uniqueAccountIds = Array.from(
    new Set(candidates.map((c) => c.accountId).filter(Boolean) as string[])
  );

  // שליפה במקביל בקבוצות של 3 (Fireberry rate-limit), עם retry בודד אחרי 500ms
  const accountInfo = new Map<
    string,
    { taxId: string | null; phone: string | null }
  >();
  const BATCH = 3;
  let failed = 0;

  async function fetchAccount(accountId: string): Promise<boolean> {
    try {
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
      const account = list[0];
      if (!account) return false;
      const taxId =
        (account.idnumber as string | null | undefined) ??
        (account.pcfsystemfield3 as string | null | undefined) ??
        null;
      const phone =
        (account.mobilephone as string | null | undefined) ??
        (account.telephone1 as string | null | undefined) ??
        (account.phone as string | null | undefined) ??
        null;
      accountInfo.set(accountId, {
        taxId: taxId ? String(taxId) : null,
        phone: phone ? String(phone) : null,
      });
      return true;
    } catch {
      return false;
    }
  }

  for (let i = 0; i < uniqueAccountIds.length; i += BATCH) {
    const batch = uniqueAccountIds.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(fetchAccount));
    // retry failed ones once
    const failedIds = batch.filter((_, idx) => !results[idx]);
    if (failedIds.length > 0) {
      await new Promise((r) => setTimeout(r, 500));
      const retryResults = await Promise.all(failedIds.map(fetchAccount));
      retryResults.forEach((ok) => {
        if (!ok) failed += 1;
      });
    }
    // small delay between batches to be polite
    await new Promise((r) => setTimeout(r, 50));
  }

  // עדכון ה-DB
  let updated = 0;
  for (const c of candidates) {
    const info = c.accountId ? accountInfo.get(c.accountId) : null;
    if (!info) continue;
    const newTaxId = c.customerTaxId ?? info.taxId;
    const newPhone = c.customerPhone ?? info.phone;
    if (newTaxId === c.customerTaxId && newPhone === c.customerPhone) continue;
    await db
      .update(fireberryPurchases)
      .set({
        customerTaxId: newTaxId,
        customerPhone: newPhone,
      })
      .where(eq(fireberryPurchases.id, c.id));
    updated += 1;
  }

  return { candidates: candidates.length, updated, failed };
}
