import { db } from "@/lib/db/client";
import { alerts } from "@/lib/db/schema";

export async function createAlert(opts: {
  severity?: "info" | "warning" | "error";
  category: string;
  title: string;
  message: string;
  relatedIssuedInvoiceId?: number;
  relatedBankTxId?: number;
  context?: unknown;
}) {
  await db.insert(alerts).values({
    severity: opts.severity ?? "warning",
    category: opts.category,
    title: opts.title,
    message: opts.message,
    relatedIssuedInvoiceId: opts.relatedIssuedInvoiceId,
    relatedBankTxId: opts.relatedBankTxId,
    contextJson: opts.context ? JSON.stringify(opts.context) : null,
  });
}
