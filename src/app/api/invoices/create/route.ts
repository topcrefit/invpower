import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  fireberryPurchases,
  issuedInvoices,
  alerts,
} from "@/lib/db/schema";
import {
  fireberryCreateInvoice,
  fireberryWaitForInvoiceNumber,
  fireberryMarkPurchaseInvoiceSent,
  fireberryTriggerInvoiceCreation,
  fireberryUploadPdfToInvoiceRecord,
} from "@/lib/fireberry/client";
import { cardcomDownloadPdfByNumber } from "@/lib/cardcom/client";
import {
  fetchBankSheetRows,
  findMatchingRow,
  markRowAsInvoiced,
} from "@/lib/google-sheets/client";
import { syncFireberryPurchases } from "@/lib/fireberry/sync";
import { findExistingCardcomInvoice } from "@/lib/invoices/check-duplicates";
import { createAlert } from "@/lib/alerts/create";

export const runtime = "nodejs";

const schema = z.object({
  pairs: z
    .array(
      z.object({
        bankTransactionId: z.number().int().positive(),
        fireberryPurchaseId: z.number().int().positive(),
      })
    )
    .min(1),
});

type ItemResult = {
  bankTransactionId: number;
  fireberryPurchaseId: number;
  status: "issued" | "skipped" | "failed" | "partial";
  message: string;
  invoiceNumber?: string;
  invoiceLink?: string;
};

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const results: ItemResult[] = [];

  for (const pair of parsed.data.pairs) {
    const txRows = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, pair.bankTransactionId));
    const tx = txRows[0];
    if (!tx) {
      results.push({
        ...pair,
        status: "failed",
        message: "תנועה בנקאית לא נמצאה",
      });
      continue;
    }

    const fbRows = await db
      .select()
      .from(fireberryPurchases)
      .where(eq(fireberryPurchases.id, pair.fireberryPurchaseId));
    const fb = fbRows[0];
    if (!fb) {
      results.push({
        ...pair,
        status: "failed",
        message: "רכישת Fireberry לא נמצאה",
      });
      continue;
    }

    // 1. כפילות אצלנו?
    const existingOurs = await db
      .select()
      .from(issuedInvoices)
      .where(eq(issuedInvoices.bankTransactionId, tx.id));
    const alreadyIssued = existingOurs.find(
      (i) => i.status === "issued" || i.status === "partial"
    );
    if (alreadyIssued) {
      results.push({
        ...pair,
        status: "skipped",
        message: `כבר הופקה: ${alreadyIssued.cardcomInvoiceNumber}`,
        invoiceNumber: alreadyIssued.cardcomInvoiceNumber ?? undefined,
        invoiceLink: alreadyIssued.cardcomInvoiceLink ?? undefined,
      });
      continue;
    }
    // אם קיימות רשומות ישנות במצב failed/pending לאותו זוג — מוחקים כדי לאפשר ניסיון חוזר.
    // קודם מנקים alerts שמצביעים אליהן (FK), אחרת DELETE נכשל.
    const stale = existingOurs.filter(
      (i) => i.status === "failed" || i.status === "pending"
    );
    for (const s of stale) {
      await db.delete(alerts).where(eq(alerts.relatedIssuedInvoiceId, s.id));
      await db.delete(issuedInvoices).where(eq(issuedInvoices.id, s.id));
    }

    // 2. כפילות ב-Cardcom (מטמון)?
    const dup = await findExistingCardcomInvoice(
      tx.amount,
      fb.customerName,
      tx.txDate
    );
    if (dup) {
      results.push({
        ...pair,
        status: "skipped",
        message: `כבר קיים ב-Cardcom: ${dup.invoiceNumber} (${dup.reason})`,
        invoiceNumber: dup.invoiceNumber,
      });
      continue;
    }

    // 3. וודא שיש accountId — חובה לקריאה ל-Fireberry
    if (!fb.accountId) {
      results.push({
        ...pair,
        status: "failed",
        message: `אין accountId ברכישת Fireberry ${fb.accountProductId} — נדרש לחיבור ללקוח`,
      });
      continue;
    }

    // 4. צור רשומה pending אצלנו
    const [issued] = await db
      .insert(issuedInvoices)
      .values({
        bankTransactionId: tx.id,
        fireberryPurchaseId: fb.id,
        issuedByUserId: session.userId,
        txDate: tx.txDate,
        amount: tx.amount,
        asmachta: tx.reference,
        customerName: tx.extractedName ?? fb.customerName ?? "לקוח לא מזוהה",
        customerTaxId: fb.customerTaxId,
        customerPhone: fb.customerPhone,
        fireberryAccountId: fb.accountId,
        productName: fb.invoiceLinesDescription ?? fb.productName,
        status: "pending",
        fireberryUploadStatus: "pending",
      })
      .returning();

    // 5. POST ל-Fireberry: יצירת רשומת "חשבונית מס קבלה" ב-customobject1004
    //    Fireberry קוראת ל-Cardcom פנימית עם הסיווג הנכון "העברה בנקאית"
    let fbInvoiceResult;
    try {
      fbInvoiceResult = await fireberryCreateInvoice({
        customerName: tx.extractedName ?? fb.customerName ?? "לקוח לא מזוהה",
        accountId: fb.accountId,
        customerTaxId: fb.customerTaxId,
        customerPhone: fb.customerPhone,
        productDescription:
          fb.invoiceLinesDescription ?? fb.productName ?? "תשלום",
        amount: tx.amount,
        asmachta: tx.reference,
        bankDate: tx.txDate,
        comments: `אסמכתא בנק ${tx.reference ?? ""} | ${tx.extractedName ?? ""}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(issuedInvoices)
        .set({ status: "failed", errorMessage: msg })
        .where(eq(issuedInvoices.id, issued.id));
      await createAlert({
        severity: "error",
        category: "fireberry_invoice_create",
        title: "שגיאה ביצירת חשבונית ב-Fireberry",
        message: msg,
        relatedIssuedInvoiceId: issued.id,
        relatedBankTxId: tx.id,
      });
      results.push({ ...pair, status: "failed", message: msg });
      continue;
    }

    if (!fbInvoiceResult.ok || !fbInvoiceResult.recordId) {
      const msg =
        fbInvoiceResult.message ?? "Fireberry לא החזיר recordId תקין";
      await db
        .update(issuedInvoices)
        .set({
          status: "failed",
          errorMessage: msg,
          cardcomResponseRaw: JSON.stringify(fbInvoiceResult.raw),
        })
        .where(eq(issuedInvoices.id, issued.id));
      await createAlert({
        severity: "error",
        category: "fireberry_invoice_create",
        title: "Fireberry החזיר תגובה לא תקינה",
        message: msg,
        relatedIssuedInvoiceId: issued.id,
        relatedBankTxId: tx.id,
        context: fbInvoiceResult.raw,
      });
      results.push({ ...pair, status: "failed", message: msg });
      continue;
    }

    // 6. מפעילים את הטריגר של הקבלן (אותו דבר כמו לחיצה על הכפתור "חשבונית מס קבלה")
    const triggerRes = await fireberryTriggerInvoiceCreation(
      fbInvoiceResult.recordId
    );
    if (!triggerRes.ok) {
      await createAlert({
        severity: "warning",
        category: "fireberry_trigger",
        title: "טריגר יצירת החשבונית נכשל",
        message: `נוצרה רשומה ב-Fireberry (${fbInvoiceResult.recordId}), אך הטריגר ל-Cardcom נכשל (HTTP ${triggerRes.status}). ייתכן שצריך ללחוץ ידנית על הכפתור.`,
        relatedIssuedInvoiceId: issued.id,
        relatedBankTxId: tx.id,
      });
    }

    // 7. ממתינים שהאוטומציה תחזיר מספר חשבונית מ-Cardcom
    const waited = await fireberryWaitForInvoiceNumber(
      fbInvoiceResult.recordId,
      30
    );

    // 7. עדכן את הרשומה אצלנו
    const cardcomNumber = waited.docNumber ?? null;
    await db
      .update(issuedInvoices)
      .set({
        cardcomInvoiceNumber: cardcomNumber,
        cardcomInvoiceLink: waited.pdfUrl ?? null,
        cardcomResponseRaw: JSON.stringify({
          fireberryRecordId: fbInvoiceResult.recordId,
          waited,
        }),
        fireberryFileId: fbInvoiceResult.recordId,
        status: cardcomNumber ? "issued" : "partial",
        issuedAt: new Date(),
      })
      .where(eq(issuedInvoices.id, issued.id));

    // 7a. הורדת PDF מ-Cardcom והעלאה לרשומת customobject1004
    //     משתמשים ב-GetDocumentPDF.aspx (לפי תיעוד הקבלן) — מחזיר PDF ישירות
    //     ה-PDF מצורף לרשומת החשבונית, שמופיעה אוטומטית בתיק הלקוח (דרך pcfmainaccount)
    let pdfUploadStatus: "uploaded" | "failed" | "skipped" = "skipped";
    if (cardcomNumber && fbInvoiceResult.recordId) {
      try {
        const pdf = await cardcomDownloadPdfByNumber(cardcomNumber, 1);
        const fileName = `invoice_${cardcomNumber}.pdf`;
        const upl = await fireberryUploadPdfToInvoiceRecord(
          fbInvoiceResult.recordId,
          pdf,
          fileName
        );
        if (upl.ok) {
          pdfUploadStatus = "uploaded";
          await db
            .update(issuedInvoices)
            .set({ fireberryUploadStatus: "uploaded" })
            .where(eq(issuedInvoices.id, issued.id));
        } else {
          pdfUploadStatus = "failed";
          await createAlert({
            severity: "warning",
            category: "fireberry_upload",
            title: "העלאת PDF ל-customobject1004 נכשלה",
            message: `חשבונית ${cardcomNumber} (${fb.customerName}) הופקה אבל העלאת ה-PDF לרשומה ב-Fireberry נכשלה: HTTP ${upl.status} ${upl.body}`,
            relatedIssuedInvoiceId: issued.id,
            relatedBankTxId: tx.id,
          });
        }
      } catch (e) {
        pdfUploadStatus = "failed";
        const msg = e instanceof Error ? e.message : String(e);
        await db
          .update(issuedInvoices)
          .set({ fireberryUploadStatus: "failed", errorMessage: msg })
          .where(eq(issuedInvoices.id, issued.id));
        await createAlert({
          severity: "warning",
          category: "fireberry_upload",
          title: "העלאת PDF נכשלה",
          message: `חשבונית ${cardcomNumber} (${fb.customerName}) הופקה אבל ה-PDF לא הועלה: ${msg}`,
          relatedIssuedInvoiceId: issued.id,
          relatedBankTxId: tx.id,
        });
      }
    }

    // 7b. עדכן את ה-Google Sheet (אם הופקה חשבונית בהצלחה)
    if (cardcomNumber && pdfUploadStatus === "uploaded") {
      try {
        const sheetRows = await fetchBankSheetRows();
        const match = findMatchingRow(
          sheetRows,
          tx.reference,
          tx.amount,
          tx.txDate
        );
        if (match) {
          const upd = await markRowAsInvoiced(match.rowIndex, cardcomNumber);
          if (!upd.ok) {
            await createAlert({
              severity: "warning",
              category: "google_sheet_update",
              title: "עדכון ה-Google Sheet נכשל",
              message: `חשבונית ${cardcomNumber} הופקה אך עדכון שורה ${match.rowIndex} ב-Sheet נכשל: ${upd.message}`,
              relatedIssuedInvoiceId: issued.id,
              relatedBankTxId: tx.id,
            });
          }
        } else {
          await createAlert({
            severity: "warning",
            category: "google_sheet_no_match",
            title: "לא נמצאה שורה תואמת ב-Google Sheet",
            message: `חשבונית ${cardcomNumber} (${fb.customerName}) הופקה אך לא נמצאה שורה תואמת ב-Sheet עבור תאריך ${tx.txDate.toISOString().slice(0, 10)} | אסמכתא ${tx.reference} | סכום ${tx.amount}`,
            relatedIssuedInvoiceId: issued.id,
            relatedBankTxId: tx.id,
          });
        }
      } catch (e) {
        await createAlert({
          severity: "warning",
          category: "google_sheet_update",
          title: "שגיאה בעדכון Google Sheet",
          message: e instanceof Error ? e.message : String(e),
          relatedIssuedInvoiceId: issued.id,
          relatedBankTxId: tx.id,
        });
      }
    }

    // 8. סמן ב-Fireberry את הרכישה כ"נשלח"
    let invoiceMarked: "marked" | "failed" | "skipped" = "skipped";
    try {
      const markRes = await fireberryMarkPurchaseInvoiceSent(fb.accountProductId);
      if (markRes.ok) {
        invoiceMarked = "marked";
      } else {
        invoiceMarked = "failed";
        await createAlert({
          severity: "warning",
          category: "fireberry_status_update",
          title: "עדכון סטטוס חשבונית ב-Fireberry נכשל",
          message: `חשבונית ${cardcomNumber ?? "(טרם הוקצה)"} (לקוח: ${fb.customerName}) הופקה, אך לא הצלחנו לעדכן את הרכישה ל"נשלח" (status ${markRes.status}: ${markRes.message ?? ""})`,
          relatedIssuedInvoiceId: issued.id,
          relatedBankTxId: tx.id,
        });
      }
    } catch (e) {
      invoiceMarked = "failed";
      await createAlert({
        severity: "warning",
        category: "fireberry_status_update",
        title: "עדכון סטטוס חשבונית ב-Fireberry נכשל (חריגה)",
        message: `חשבונית ${cardcomNumber ?? "?"} הופקה, אך עדכון סטטוס "נשלח" נכשל: ${e instanceof Error ? e.message : String(e)}`,
        relatedIssuedInvoiceId: issued.id,
        relatedBankTxId: tx.id,
      });
    }

    const fullSuccess =
      !!cardcomNumber &&
      invoiceMarked === "marked" &&
      pdfUploadStatus !== "failed";
    results.push({
      ...pair,
      status: fullSuccess ? "issued" : "partial",
      message: fullSuccess
        ? `הופק ${cardcomNumber} | PDF הועלה לתיק הלקוח | סומן "נשלח"`
        : cardcomNumber
          ? `הופק ${cardcomNumber} | PDF: ${pdfUploadStatus} | סימון: ${invoiceMarked}`
          : `נוצרה רשומה ב-Fireberry (${fbInvoiceResult.recordId.slice(0, 8)}…) — ממתין למספר חשבונית מ-Cardcom`,
      invoiceNumber: cardcomNumber ?? undefined,
      invoiceLink: waited.pdfUrl ?? undefined,
    });
  }

  // אחרי הפקה — סנכרון מחדש עם Fireberry כדי שהשורות שכבר קיבלו חשבונית
  // ייעלמו מ"מועמדות להפקה" (הן מסומנות עכשיו "נשלח")
  const anyIssued = results.some(
    (r) => r.status === "issued" || r.status === "partial"
  );
  if (anyIssued) {
    try {
      await syncFireberryPurchases();
    } catch (e) {
      // לא חוסמים את ה-response בגלל סנכרון נכשל
      console.error("Post-issue sync failed:", e);
    }
  }

  return NextResponse.json({ ok: true, results });
}
