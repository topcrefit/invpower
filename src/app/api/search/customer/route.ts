import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import {
  bankTransactions,
  fireberryPurchases,
  cardcomInvoices,
  issuedInvoices,
} from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { nameSimilarity } from "@/lib/match/name-match";
import { or, like, eq, desc, sql } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * חיפוש לקוח חוצה-מערכות.
 * GET /api/search/customer?q=<query>
 *
 * - אם q כולו ספרות באורך 9 → ת.ז. (התאמה מדויקת)
 * - אם q ספרות באורך 9-10 שמתחיל ב-0 → טלפון (התאמה מדויקת)
 * - אחרת → שם, fuzzy (Levenshtein/token, סף 0.5)
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q || q.length < 2) {
    return NextResponse.json({
      ok: true,
      query: q,
      mode: "empty",
      banks: [],
      fireberry: [],
      cardcom: [],
      issued: [],
    });
  }

  const isAllDigits = /^\d+$/.test(q);
  const isPhone = isAllDigits && q.length >= 9 && q.length <= 10 && q.startsWith("0");
  const isTaxId = isAllDigits && q.length === 9 && !q.startsWith("0");
  // אסמכתא / מספר חשבונית — ספרות באורך 3-8 (לא ת.ז., לא טלפון)
  const isReference = isAllDigits && !isPhone && !isTaxId && q.length >= 3 && q.length <= 8;
  const mode: "tax_id" | "phone" | "reference" | "name" =
    isPhone ? "phone" : isTaxId ? "tax_id" : isReference ? "reference" : "name";

  // ---- Bank Transactions ----
  // אין ת.ז. בטבלת בנק → לפי שם / אסמכתא / חיפוש בתיאור המורחב
  let banks: Array<typeof bankTransactions.$inferSelect> = [];
  if (mode === "name") {
    const all = await db.select().from(bankTransactions);
    banks = all
      .filter((b) => {
        const n = b.extractedName ?? "";
        if (!n) return false;
        if (n.includes(q)) return true;
        return nameSimilarity(n, q) >= 0.5;
      })
      .slice(0, 50);
  } else if (mode === "reference") {
    banks = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.reference, q));
  } else if (mode === "phone") {
    banks = [];
  } else {
    // tax_id — נסה לחפש בתיאור המורחב
    const all = await db.select().from(bankTransactions);
    banks = all
      .filter((b) => (b.extendedDescription ?? "").includes(q))
      .slice(0, 50);
  }

  // ---- Fireberry Purchases ----
  let fbList: Array<typeof fireberryPurchases.$inferSelect> = [];
  if (mode === "tax_id") {
    fbList = await db
      .select()
      .from(fireberryPurchases)
      .where(eq(fireberryPurchases.customerTaxId, q));
  } else if (mode === "phone") {
    const phoneNoLeading = q.replace(/^0+/, "");
    fbList = await db
      .select()
      .from(fireberryPurchases)
      .where(
        or(
          eq(fireberryPurchases.customerPhone, q),
          like(fireberryPurchases.customerPhone, `%${phoneNoLeading}`)
        )
      );
  } else {
    const all = await db.select().from(fireberryPurchases);
    fbList = all
      .filter((f) => {
        const n = f.customerName ?? "";
        if (!n) return false;
        if (n.includes(q)) return true;
        return nameSimilarity(n, q) >= 0.5;
      })
      .slice(0, 100);
  }
  fbList.sort((a, b) => {
    const ad = a.createdOn ? new Date(a.createdOn).getTime() : 0;
    const bd = b.createdOn ? new Date(b.createdOn).getTime() : 0;
    return bd - ad;
  });

  // ---- Cardcom Invoices ----
  let ccList: Array<typeof cardcomInvoices.$inferSelect> = [];
  if (mode === "tax_id") {
    // ב-Cardcom יש רווחים בסוף, נשתמש ב-LIKE
    ccList = await db
      .select()
      .from(cardcomInvoices)
      .where(like(cardcomInvoices.customerId, `${q}%`));
  } else if (mode === "phone") {
    const phoneNoLeading = q.replace(/^0+/, "");
    ccList = await db
      .select()
      .from(cardcomInvoices)
      .where(
        or(
          eq(cardcomInvoices.phone, q),
          like(cardcomInvoices.phone, `%${phoneNoLeading}`)
        )
      );
  } else if (mode === "reference") {
    // אסמכתא או מספר חשבונית
    ccList = await db
      .select()
      .from(cardcomInvoices)
      .where(
        or(
          eq(cardcomInvoices.asmachta, q),
          eq(cardcomInvoices.invoiceNumber, q)
        )
      );
  } else {
    const all = await db.select().from(cardcomInvoices);
    ccList = all
      .filter((c) => {
        const n = c.customerName ?? "";
        if (!n) return false;
        if (n.includes(q)) return true;
        return nameSimilarity(n, q) >= 0.5;
      })
      .slice(0, 100);
  }
  ccList.sort((a, b) => {
    const ad = a.invoiceDate ? new Date(a.invoiceDate).getTime() : 0;
    const bd = b.invoiceDate ? new Date(b.invoiceDate).getTime() : 0;
    return bd - ad;
  });

  // ---- Issued Invoices (מה שהמערכת שלנו הפיקה) ----
  let issued: Array<typeof issuedInvoices.$inferSelect> = [];
  if (mode === "tax_id") {
    issued = await db
      .select()
      .from(issuedInvoices)
      .where(eq(issuedInvoices.customerTaxId, q));
  } else if (mode === "phone") {
    issued = await db
      .select()
      .from(issuedInvoices)
      .where(eq(issuedInvoices.customerPhone, q));
  } else if (mode === "reference") {
    issued = await db
      .select()
      .from(issuedInvoices)
      .where(
        or(
          eq(issuedInvoices.asmachta, q),
          eq(issuedInvoices.cardcomInvoiceNumber, q)
        )
      );
  } else {
    const all = await db.select().from(issuedInvoices);
    issued = all
      .filter((i) => {
        const n = i.customerName ?? "";
        if (!n) return false;
        if (n.includes(q)) return true;
        return nameSimilarity(n, q) >= 0.5;
      });
  }
  issued.sort((a, b) => {
    const ad = a.issuedAt ? new Date(a.issuedAt).getTime() : 0;
    const bd = b.issuedAt ? new Date(b.issuedAt).getTime() : 0;
    return bd - ad;
  });

  // מפת קישור: bank_tx_id → invoice_number (כדי שנציג ✓ ירוק)
  const bankToInvoice = new Map<number, string>();
  const allIssued = await db.select().from(issuedInvoices);
  for (const i of allIssued) {
    if (i.cardcomInvoiceNumber) {
      bankToInvoice.set(i.bankTransactionId, i.cardcomInvoiceNumber);
    }
  }

  return NextResponse.json({
    ok: true,
    query: q,
    mode,
    banks: banks.map((b) => ({
      id: b.id,
      txDate: b.txDate.toISOString(),
      reference: b.reference,
      amount: b.amount,
      description: b.description,
      extractedName: b.extractedName,
      extractedAccount: b.extractedAccount,
      extendedDescription: b.extendedDescription,
      linkedInvoice: bankToInvoice.get(b.id) ?? null,
    })),
    fireberry: fbList.map((f) => ({
      id: f.id,
      accountProductId: f.accountProductId,
      accountId: f.accountId,
      productName: f.productName,
      price: f.price,
      customerName: f.customerName,
      customerTaxId: f.customerTaxId,
      customerPhone: f.customerPhone,
      paymentTypeName: f.paymentTypeName,
      invoiceStatusName: f.invoiceStatusName,
      createdOn: f.createdOn ? new Date(f.createdOn).toISOString() : null,
    })),
    cardcom: ccList.map((c) => ({
      id: c.id,
      invoiceNumber: c.invoiceNumber,
      invoiceType: c.invoiceType,
      invoiceDate: c.invoiceDate ? new Date(c.invoiceDate).toISOString() : null,
      totalIncludeVat: c.totalIncludeVat,
      customerName: c.customerName,
      customerId: c.customerId,
      phone: c.phone,
      email: c.email,
      asmachta: c.asmachta,
    })),
    issued: issued.map((i) => ({
      id: i.id,
      bankTransactionId: i.bankTransactionId,
      cardcomInvoiceNumber: i.cardcomInvoiceNumber,
      cardcomInvoiceLink: i.cardcomInvoiceLink,
      customerName: i.customerName,
      customerTaxId: i.customerTaxId,
      amount: i.amount,
      asmachta: i.asmachta,
      txDate: i.txDate.toISOString(),
      issuedAt: i.issuedAt ? new Date(i.issuedAt).toISOString() : null,
      productName: i.productName,
      status: i.status,
    })),
    summary: {
      banks: banks.length,
      fireberry: fbList.length,
      cardcom: ccList.length,
      issued: issued.length,
    },
  });
}
