import { config } from "dotenv";
import { createClient } from "@libsql/client";

config({ path: "C:/DEV/INVPOWER/.env.local" });
const c = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// כל הרשומות האחרונות
const inv = await c.execute(
  "SELECT id, bank_transaction_id, fireberry_purchase_id, status, customer_name, amount, asmachta, error_message, cardcom_invoice_number, cardcom_response_raw, fireberry_upload_status, issued_at FROM issued_invoices ORDER BY id DESC LIMIT 5"
);
console.log("=== 5 רשומות אחרונות ב-issued_invoices:");
for (const r of inv.rows) {
  console.log(`\n--- id=${r.id} ---`);
  console.log(`  לקוח: ${r.customer_name}`);
  console.log(`  סכום: ${r.amount}`);
  console.log(`  אסמכתא: ${r.asmachta}`);
  console.log(`  סטטוס: ${r.status}`);
  console.log(`  cardcom invoice: ${r.cardcom_invoice_number ?? "(אין)"}`);
  console.log(`  fireberry upload: ${r.fireberry_upload_status}`);
  console.log(`  ERROR: ${r.error_message ?? "(none)"}`);
  if (r.cardcom_response_raw) {
    console.log(`  Cardcom raw response:`);
    console.log("    " + String(r.cardcom_response_raw).slice(0, 800));
  }
}

// התראות אחרונות
console.log("\n\n=== התראות אחרונות:");
const alerts = await c.execute(
  "SELECT id, severity, category, title, message, created_at FROM alerts ORDER BY id DESC LIMIT 5"
);
for (const a of alerts.rows) {
  const t = new Date(Number(a.created_at) * 1000).toISOString();
  console.log(`\n[${a.severity}] ${a.title} (${a.category}) — ${t}`);
  console.log(`  ${String(a.message).slice(0, 500)}`);
}

await c.close();
