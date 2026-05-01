import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

/* ===================================================================
   USERS + AUTH
   =================================================================== */
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name"),
    role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
  })
);

/* ===================================================================
   SETTINGS (encrypted credentials)
   =================================================================== */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  isSecret: integer("is_secret", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedBy: integer("updated_by").references(() => users.id),
});

/* ===================================================================
   BANK UPLOADS + TRANSACTIONS
   =================================================================== */
export const bankUploads = sqliteTable("bank_uploads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  dateFrom: integer("date_from", { mode: "timestamp" }),
  dateTo: integer("date_to", { mode: "timestamp" }),
  uploadedAt: integer("uploaded_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const bankTransactions = sqliteTable(
  "bank_transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uploadId: integer("upload_id")
      .notNull()
      .references(() => bankUploads.id, { onDelete: "cascade" }),
    txDate: integer("tx_date", { mode: "timestamp" }).notNull(),
    valueDate: integer("value_date", { mode: "timestamp" }),
    description: text("description"),
    reference: text("reference"),
    amount: real("amount").notNull(),
    extendedDescription: text("extended_description"),
    note: text("note"),
    extractedName: text("extracted_name"),
    extractedAccount: text("extracted_account"),
    dedupKey: text("dedup_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    dedupIdx: uniqueIndex("bank_tx_dedup_idx").on(t.dedupKey),
    dateIdx: index("bank_tx_date_idx").on(t.txDate),
    amountIdx: index("bank_tx_amount_idx").on(t.amount),
  })
);

/* ===================================================================
   FIREBERRY PURCHASES (Object 33)
   נשלפים מ: api.powerlink.co.il/api/query
   =================================================================== */
export const fireberryPurchases = sqliteTable(
  "fireberry_purchases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountProductId: text("account_product_id").notNull(), // PK ב-Fireberry
    accountId: text("account_id"), // לשימוש ב-AccountForeignKey
    productName: text("product_name"),
    invoiceLinesDescription: text("invoice_lines_description"), // pcfInvoiceLinesDescription — תיאור לחשבונית
    price: real("price"), // price ?? pcfsystemfield1007
    customerName: text("customer_name"), // accountname
    customerTaxId: text("customer_tax_id"), // idnumber (אחרי enrichment)
    customerPhone: text("customer_phone"), // mobilephone / telephone1 / phone
    customerEmail: text("customer_email"),
    paymentTypeName: text("payment_type_name"), // pcfsystemfield73name
    invoiceStatusName: text("invoice_status_name"), // pcfsystemfield147name
    createdOn: integer("created_on", { mode: "timestamp" }),
    modifiedOn: integer("modified_on", { mode: "timestamp" }),
    rawJson: text("raw_json"),
    syncedAt: integer("synced_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    apIdx: uniqueIndex("fireberry_purchases_apid_idx").on(t.accountProductId),
    nameIdx: index("fireberry_purchases_name_idx").on(t.customerName),
    priceIdx: index("fireberry_purchases_price_idx").on(t.price),
    createdIdx: index("fireberry_purchases_created_idx").on(t.createdOn),
  })
);

/* ===================================================================
   CARDCOM INVOICES — שדות לפי v2 mapping (GetReport)
   =================================================================== */
export const cardcomInvoices = sqliteTable(
  "cardcom_invoices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceType: integer("invoice_type"),
    invoiceDate: integer("invoice_date", { mode: "timestamp" }),
    totalIncludeVat: real("total_include_vat"),
    totalNoVat: real("total_no_vat"),
    vatOnly: real("vat_only"),
    customerName: text("customer_name"),
    customerId: text("customer_id"), // CustID מ-Cardcom
    email: text("email"),
    phone: text("phone"),
    asmachta: text("asmachta"),
    rawData: text("raw_data"),
    syncedAt: integer("synced_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    invNumIdx: uniqueIndex("cardcom_invoices_num_idx").on(t.invoiceNumber),
    dateIdx: index("cardcom_invoices_date_idx").on(t.invoiceDate),
    amountIdx: index("cardcom_invoices_amount_idx").on(t.totalIncludeVat),
  })
);

/* ===================================================================
   ISSUED INVOICES — מה שהמערכת שלנו הפיקה
   =================================================================== */
export const issuedInvoices = sqliteTable(
  "issued_invoices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bankTransactionId: integer("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id),
    fireberryPurchaseId: integer("fireberry_purchase_id").references(
      () => fireberryPurchases.id
    ),
    issuedByUserId: integer("issued_by_user_id")
      .notNull()
      .references(() => users.id),

    // נתוני המקור (מועתקים בזמן הפקה)
    txDate: integer("tx_date", { mode: "timestamp" }).notNull(),
    amount: real("amount").notNull(),
    asmachta: text("asmachta"),
    customerName: text("customer_name").notNull(),
    customerTaxId: text("customer_tax_id"),
    customerPhone: text("customer_phone"),
    fireberryAccountId: text("fireberry_account_id"),
    productName: text("product_name"),

    // תשובה מ-Cardcom
    cardcomInvoiceNumber: text("cardcom_invoice_number"),
    cardcomInvoiceLink: text("cardcom_invoice_link"), // URL ל-PDF
    cardcomResponseRaw: text("cardcom_response_raw"),

    // העלאה ל-Fireberry
    fireberryFileId: text("fireberry_file_id"),
    fireberryUploadStatus: text("fireberry_upload_status", {
      enum: ["pending", "uploaded", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),

    status: text("status", {
      enum: ["pending", "issued", "failed", "partial"],
    })
      .notNull()
      .default("pending"),
    errorMessage: text("error_message"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    issuedAt: integer("issued_at", { mode: "timestamp" }),
  },
  (t) => ({
    bankTxIdx: index("issued_inv_bank_tx_idx").on(t.bankTransactionId),
    invNumIdx: index("issued_inv_inv_num_idx").on(t.cardcomInvoiceNumber),
    dedupIdx: uniqueIndex("issued_inv_dedup_idx").on(
      t.bankTransactionId,
      t.fireberryPurchaseId
    ),
  })
);

/* ===================================================================
   BANK ↔ CARDCOM MANUAL MATCHES (אישורים ידניים)
   =================================================================== */
export const bankCardcomMatches = sqliteTable(
  "bank_cardcom_matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bankTransactionId: integer("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id, { onDelete: "cascade" }),
    cardcomInvoiceNumber: text("cardcom_invoice_number").notNull(),
    note: text("note"),
    approvedByUserId: integer("approved_by_user_id")
      .notNull()
      .references(() => users.id),
    approvedAt: integer("approved_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    bankTxIdx: uniqueIndex("bank_cc_match_bank_tx_idx").on(t.bankTransactionId),
    invIdx: index("bank_cc_match_inv_idx").on(t.cardcomInvoiceNumber),
  })
);

/* ===================================================================
   BANK ↔ FIREBERRY MANUAL MATCHES (אישורים ידניים — שלב ב׳)
   =================================================================== */
export const bankFireberryMatches = sqliteTable(
  "bank_fireberry_matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bankTransactionId: integer("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id, { onDelete: "cascade" }),
    fireberryPurchaseId: integer("fireberry_purchase_id")
      .notNull()
      .references(() => fireberryPurchases.id, { onDelete: "cascade" }),
    note: text("note"),
    approvedByUserId: integer("approved_by_user_id")
      .notNull()
      .references(() => users.id),
    approvedAt: integer("approved_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    bankTxIdx: uniqueIndex("bank_fb_match_bank_tx_idx").on(t.bankTransactionId),
    fbIdx: index("bank_fb_match_fb_idx").on(t.fireberryPurchaseId),
  })
);

/* ===================================================================
   BANK NO-INVOICE APPROVALS — אישור אדמין שאין צורך בחשבונית
   (החזרי מס הכנסה / ביטוח לאומי / כסף שהלקוח החזיר וכו')
   =================================================================== */
export const bankNoInvoiceApprovals = sqliteTable(
  "bank_no_invoice_approvals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    bankTransactionId: integer("bank_transaction_id")
      .notNull()
      .references(() => bankTransactions.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    approvedByUserId: integer("approved_by_user_id")
      .notNull()
      .references(() => users.id),
    approvedAt: integer("approved_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    bankTxIdx: uniqueIndex("bank_no_inv_appr_bank_tx_idx").on(t.bankTransactionId),
  })
);

/* ===================================================================
   ALERTS
   =================================================================== */
export const alerts = sqliteTable(
  "alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    severity: text("severity", { enum: ["info", "warning", "error"] })
      .notNull()
      .default("warning"),
    category: text("category").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    relatedIssuedInvoiceId: integer("related_issued_invoice_id").references(
      () => issuedInvoices.id
    ),
    relatedBankTxId: integer("related_bank_tx_id").references(
      () => bankTransactions.id
    ),
    contextJson: text("context_json"),
    acknowledgedAt: integer("acknowledged_at", { mode: "timestamp" }),
    acknowledgedBy: integer("acknowledged_by").references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    statusIdx: index("alerts_ack_idx").on(t.acknowledgedAt),
    createdIdx: index("alerts_created_idx").on(t.createdAt),
  })
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type FireberryPurchase = typeof fireberryPurchases.$inferSelect;
export type IssuedInvoice = typeof issuedInvoices.$inferSelect;
export type CardcomInvoice = typeof cardcomInvoices.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type BankCardcomMatch = typeof bankCardcomMatches.$inferSelect;
export type BankFireberryMatch = typeof bankFireberryMatches.$inferSelect;
export type BankNoInvoiceApproval = typeof bankNoInvoiceApprovals.$inferSelect;
