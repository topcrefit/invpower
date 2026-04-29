import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  fireberryPurchases,
  issuedInvoices,
} from "@/lib/db/schema";
import {
  cardcomCreateTaxInvoice,
  cardcomDownloadPdfFromUrl,
} from "@/lib/cardcom/client";
import { fireberryUploadPdfToAccount } from "@/lib/fireberry/client";
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
    const alreadyIssued = existingOurs.find((i) => i.status === "issued");
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

    // 3. צור רשומה pending
    const [issued] = await db
      .insert(issuedInvoices)
      .values({
        bankTransactionId: tx.id,
        fireberryPurchaseId: fb.id,
        issuedByUserId: session.userId,
        txDate: tx.txDate,
        amount: tx.amount,
        asmachta: tx.reference,
        customerName: fb.customerName ?? "לקוח לא מזוהה",
        customerTaxId: fb.customerTaxId,
        customerPhone: fb.customerPhone,
        fireberryAccountId: fb.accountId,
        productName: fb.productName,
        status: "pending",
        fireberryUploadStatus: "pending",
      })
      .returning();

    // 4. Cardcom CreateTaxInvoice
    let cardcomResult;
    try {
      cardcomResult = await cardcomCreateTaxInvoice({
        customerName: fb.customerName ?? "לקוח לא מזוהה",
        customerTaxId: fb.customerTaxId,
        customerPhone: fb.customerPhone,
        fireberryAccountId: fb.accountId,
        productDescription: fb.productName ?? "תשלום",
        amount: tx.amount,
        asmachta: tx.reference,
        bankDate: tx.txDate,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .update(issuedInvoices)
        .set({ status: "failed", errorMessage: msg })
        .where(eq(issuedInvoices.id, issued.id));
      await createAlert({
        severity: "error",
        category: "cardcom_create",
        title: "שגיאה ביצירת חשבונית ב-Cardcom",
        message: msg,
        relatedIssuedInvoiceId: issued.id,
        relatedBankTxId: tx.id,
      });
      results.push({ ...pair, status: "failed", message: msg });
      continue;
    }

    if (cardcomResult.responseCode !== 0 || !cardcomResult.invoiceNumber) {
      const msg = `Cardcom error ${cardcomResult.responseCode}: ${cardcomResult.description ?? "unknown"}`;
      await db
        .update(issuedInvoices)
        .set({
          status: "failed",
          errorMessage: msg,
          cardcomResponseRaw: JSON.stringify(cardcomResult.raw),
        })
        .where(eq(issuedInvoices.id, issued.id));
      await createAlert({
        severity: "error",
        category: "cardcom_create",
        title: "Cardcom החזיר שגיאה",
        message: msg,
        relatedIssuedInvoiceId: issued.id,
        relatedBankTxId: tx.id,
        context: cardcomResult.raw,
      });
      results.push({ ...pair, status: "failed", message: msg });
      continue;
    }

    await db
      .update(issuedInvoices)
      .set({
        cardcomInvoiceNumber: cardcomResult.invoiceNumber,
        cardcomInvoiceLink: cardcomResult.invoiceLink,
        cardcomResponseRaw: JSON.stringify(cardcomResult.raw),
        status: "issued",
        issuedAt: new Date(),
      })
      .where(eq(issuedInvoices.id, issued.id));

    // 5. הורד PDF והעלה ל-Fireberry account
    let uploadStatus: "uploaded" | "failed" | "skipped" = "skipped";
    try {
      if (!fb.accountId) {
        uploadStatus = "skipped";
        await db
          .update(issuedInvoices)
          .set({ fireberryUploadStatus: "skipped" })
          .where(eq(issuedInvoices.id, issued.id));
        await createAlert({
          severity: "warning",
          category: "fireberry_account_missing",
          title: "אין accountId ברכישה",
          message: `החשבונית ${cardcomResult.invoiceNumber} הופקה, אך לרכישת Fireberry ${fb.accountProductId} אין accountId. נדרש טיפול ידני.`,
          relatedIssuedInvoiceId: issued.id,
          relatedBankTxId: tx.id,
        });
      } else if (!cardcomResult.invoiceLink) {
        uploadStatus = "skipped";
        await db
          .update(issuedInvoices)
          .set({ fireberryUploadStatus: "skipped" })
          .where(eq(issuedInvoices.id, issued.id));
        await createAlert({
          severity: "warning",
          category: "cardcom_no_pdf_link",
          title: "Cardcom לא החזיר InvoiceLink",
          message: `חשבונית ${cardcomResult.invoiceNumber} הופקה אך ללא InvoiceLink — לא ניתן להעלות PDF. נדרש טיפול ידני.`,
          relatedIssuedInvoiceId: issued.id,
          relatedBankTxId: tx.id,
        });
      } else {
        const pdf = await cardcomDownloadPdfFromUrl(cardcomResult.invoiceLink);
        const fileName = `חשבונית_מס_קבלה_${cardcomResult.invoiceNumber}.pdf`;
        const upl = await fireberryUploadPdfToAccount(fb.accountId, fileName, pdf);
        uploadStatus = "uploaded";
        await db
          .update(issuedInvoices)
          .set({ fireberryFileId: upl.fileId, fireberryUploadStatus: "uploaded" })
          .where(eq(issuedInvoices.id, issued.id));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      uploadStatus = "failed";
      await db
        .update(issuedInvoices)
        .set({ fireberryUploadStatus: "failed", errorMessage: msg, status: "partial" })
        .where(eq(issuedInvoices.id, issued.id));
      await createAlert({
        severity: "error",
        category: "fireberry_upload",
        title: "החשבונית הופקה אבל ההעלאה ל-Fireberry נכשלה",
        message: `חשבונית ${cardcomResult.invoiceNumber} (לקוח: ${fb.customerName}) הופקה ב-Cardcom, אך נכשל שלב ההעלאה ל-Fireberry: ${msg}. נדרש טיפול ידני.`,
        relatedIssuedInvoiceId: issued.id,
        relatedBankTxId: tx.id,
      });
    }

    results.push({
      ...pair,
      status: uploadStatus === "uploaded" ? "issued" : "partial",
      message:
        uploadStatus === "uploaded"
          ? `הופק והועלה: ${cardcomResult.invoiceNumber}`
          : `הופק (${cardcomResult.invoiceNumber}), העלאה ל-Fireberry: ${uploadStatus}`,
      invoiceNumber: cardcomResult.invoiceNumber,
      invoiceLink: cardcomResult.invoiceLink,
    });
  }

  return NextResponse.json({ ok: true, results });
}
