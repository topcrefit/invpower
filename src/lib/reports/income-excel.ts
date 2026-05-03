import * as XLSX from "xlsx";

/**
 * בניית דוח הכנסות בפורמט אקסל זהה לדוגמה של Cardcom:
 * 18 עמודות תחת 3 כותרות-על: "פרטי מסמך" / "שקל" / "פרטי לקוח".
 * שורת סיכום בתחתית.
 *
 * מקבל מערך גולמי של מסמכים מ-Cardcom GetReport.
 */
export function buildIncomeReportXlsx(
  documents: Array<Record<string, unknown>>
): Buffer {
  // --- מיפוי שדות מ-Cardcom לעמודות הדוח ---
  type Row = {
    date: string;
    time: string;
    docNumber: string;
    docType: string;
    taxable: number;
    nonTaxable: number;
    vat: number;
    totalInvoice: number;
    cash: number;
    cheques: number;
    creditCard: number;
    totalReceipt: number;
    bankTransfer: number;
    customerId: string;
    customerName: string;
    phone: string;
    email: string;
  };

  const rows: Row[] = documents.map((d) => {
    const dateOnly = String(d.InvoiceDateOnly ?? d.InvoiceDate ?? "");
    const dateTime = String(d.InvoiceDate ?? d.InvoiceDateOnly ?? "");
    const dt = dateOnly ? new Date(dateOnly) : null;
    const dtFull = dateTime ? new Date(dateTime) : null;
    const dateStr = dt
      ? `${String(dt.getDate()).padStart(2, "0")}/${String(
          dt.getMonth() + 1
        ).padStart(2, "0")}/${dt.getFullYear()}`
      : "";
    const timeStr = dtFull
      ? `${String(dtFull.getHours()).padStart(2, "0")}:${String(
          dtFull.getMinutes()
        ).padStart(2, "0")}`
      : "";
    const invType = Number(d.InvoiceType ?? 1);
    const docTypeName =
      invType === 1
        ? "חשבונית מס קבלה"
        : invType === 305
          ? "חשבונית מס"
          : invType === 3
            ? "חשבונית מס קבלה"
            : `סוג ${invType}`;
    return {
      date: dateStr,
      time: timeStr,
      docNumber: String(d.Invoice_Number ?? ""),
      docType: docTypeName,
      taxable: num(d.TotalNoVatNIS),
      nonTaxable: num(d.TotalVatFreeNIS),
      vat: num(d.VATOnlyNIS),
      totalInvoice: num(d.TotalIncludeVATNIS),
      cash: num(d.TotalChashNIS),
      cheques: num(d.TotalChequesNIS),
      creditCard: num(d.TotalCreditCardNIS),
      totalReceipt: num(d.TotalRicipientNIS),
      bankTransfer: num(d.TotalCustomeTransactionNIS),
      customerId: String(d.Comp_ID ?? "").trim(),
      customerName: String(d.Cust_Name ?? ""),
      phone: String(d.Cust_MobilePH ?? d.Cust_LinePH ?? ""),
      email: String(d.Email ?? ""),
    };
  });

  // --- AOA (array of arrays) — שתי שורות כותרת + נתונים + סיכום ---
  const aoa: (string | number)[][] = [];
  // שורה 1 — כותרות-על
  aoa.push([
    "פרטי מסמך",
    "",
    "",
    "שקל",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "פרטי לקוח",
    "",
    "",
    "",
  ]);
  // שורה 2 — כותרות עמודות
  aoa.push([
    "תאריך",
    "שעה",
    "מס מסמך",
    "סוג",
    'חייב במע"מ',
    'לא חייב במע"מ',
    'מע"מ נגבה',
    'סה"כ חשבונית',
    "מזומן",
    "המחאות",
    "כרטיס אשראי",
    'סה"כ קבלה',
    "העברה בנקאית",
    "ת.ז. ח.פ.",
    "שם לקוח",
    "טלפון נייד",
    "אימייל",
  ]);
  // נתונים
  for (const r of rows) {
    aoa.push([
      r.date,
      r.time,
      r.docNumber,
      r.docType,
      r.taxable,
      r.nonTaxable,
      r.vat,
      r.totalInvoice,
      r.cash,
      r.cheques,
      r.creditCard,
      r.totalReceipt,
      r.bankTransfer,
      r.customerId,
      r.customerName,
      r.phone,
      r.email,
    ]);
  }
  // שורת סיכום
  const sum = (key: keyof Row) =>
    rows.reduce((acc, row) => acc + (Number(row[key]) || 0), 0);
  aoa.push([
    "",
    "",
    `כמות: ${rows.length}`,
    "",
    sum("taxable"),
    sum("nonTaxable"),
    sum("vat"),
    sum("totalInvoice"),
    sum("cash"),
    sum("cheques"),
    sum("creditCard"),
    sum("totalReceipt"),
    sum("bankTransfer"),
    "",
    "",
    "",
    "",
  ]);

  // --- בנייה ב-XLSX ---
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // מיזוג כותרות-על: A1:C1 = פרטי מסמך, D1:M1 = שקל, N1:Q1 = פרטי לקוח
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 2 } },
    { s: { r: 0, c: 3 }, e: { r: 0, c: 12 } },
    { s: { r: 0, c: 13 }, e: { r: 0, c: 16 } },
  ];

  // רוחב עמודות סבירים
  ws["!cols"] = [
    { wch: 11 }, // תאריך
    { wch: 7 }, // שעה
    { wch: 10 }, // מס מסמך
    { wch: 18 }, // סוג
    { wch: 11 }, // חייב במע"מ
    { wch: 13 }, // לא חייב
    { wch: 11 }, // מע"מ
    { wch: 13 }, // סה"כ חשבונית
    { wch: 9 }, // מזומן
    { wch: 9 }, // המחאות
    { wch: 12 }, // כרטיס אשראי
    { wch: 11 }, // סה"כ קבלה
    { wch: 13 }, // העברה בנקאית
    { wch: 13 }, // ת.ז. ח.פ.
    { wch: 22 }, // שם לקוח
    { wch: 13 }, // טלפון
    { wch: 28 }, // אימייל
  ];

  // RTL — מימין לשמאל
  ws["!sheetView"] = [{ rightToLeft: true } as unknown as never];

  XLSX.utils.book_append_sheet(wb, ws, "מסמכים");

  // החזרת Buffer לקריאה כקובץ
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return buf as Buffer;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
