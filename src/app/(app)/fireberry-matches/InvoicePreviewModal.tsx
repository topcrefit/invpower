"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, X, Loader2, AlertTriangle } from "lucide-react";
import { formatDateIL, formatILS } from "@/lib/utils";

export type InvoicePreviewItem = {
  purchaseId: number;
  bankTransactionId: number;
  // Header — Customer
  customerName: string; // מהבנק (extractedName)
  customerTaxId: string | null; // מ-Fireberry
  customerPhone: string | null; // מ-Fireberry
  customerEmail: string | null; // מ-Fireberry
  // Body — Product line
  productDescription: string; // מ-Fireberry (invoiceLinesDescription)
  amount: number; // מהבנק
  // Footer — Payment
  asmachta: string | null; // מהבנק (reference)
  bankDate: string; // מהבנק (txDate ISO)
  // Meta
  isMedium: boolean; // האם דורש אישור לפני הפקה
  note: string; // הערה אופציונלית
};

export default function InvoicePreviewModal({
  items,
  onClose,
  onConfirm,
  issuing,
}: {
  items: InvoicePreviewItem[];
  onClose: () => void;
  onConfirm: () => void;
  issuing: boolean;
}) {
  const [idx, setIdx] = useState(0);
  if (items.length === 0) return null;
  const item = items[idx];
  const total = items.length;

  const VAT_RATE = 0.18;
  const beforeVat = item.amount / (1 + VAT_RATE);
  const vat = item.amount - beforeVat;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-3xl w-full max-h-[95vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3 bg-amber-50">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="w-5 h-5" />
            <span className="font-semibold">תצוגה מקדימה — לפני הפקה</span>
          </div>
          <button
            onClick={onClose}
            disabled={issuing}
            className="text-slate-500 hover:text-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Invoice mockup */}
        <div className="p-6 bg-white" style={{ direction: "rtl" }}>
          <div className="border rounded-lg p-6 bg-white">
            {/* Top — Company + Customer */}
            <div className="flex items-start justify-between border-b pb-4 mb-4">
              <div>
                <div className="text-xs text-slate-500 mb-1">לכבוד:</div>
                <div className="font-bold text-base">{item.customerName}</div>
                {item.customerTaxId && (
                  <div className="text-sm">
                    <span className="text-slate-500">ת.ז.</span>{" "}
                    {item.customerTaxId}
                  </div>
                )}
                {item.customerPhone && (
                  <div className="text-sm">
                    <span className="text-slate-500">נייד:</span>{" "}
                    {item.customerPhone}
                  </div>
                )}
                {item.customerEmail && (
                  <div className="text-sm uppercase">{item.customerEmail}</div>
                )}
              </div>
              <div className="text-left">
                <div className="text-emerald-700 font-bold text-lg">
                  ביו קרדיט
                </div>
                <div className="text-xs text-slate-600 leading-tight">
                  תל אביב
                  <br />
                  יגיע כפיים 2
                  <br />
                  0796666000
                  <br />
                  516478682
                </div>
              </div>
            </div>

            <div className="text-center text-emerald-700 font-bold text-lg my-4">
              חשבונית מס קבלה (תצוגה מקדימה)
            </div>

            {/* Product table */}
            <div className="border-t border-emerald-300 mb-4">
              <div className="grid grid-cols-12 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                <div className="col-span-7">תאור</div>
                <div className="col-span-2 text-center">כמות</div>
                <div className="col-span-3 text-left">סה"כ</div>
              </div>
              <div className="grid grid-cols-12 px-3 py-3 border-b">
                <div className="col-span-7">{item.productDescription}</div>
                <div className="col-span-2 text-center">1.00</div>
                <div className="col-span-3 text-left font-medium">
                  {item.amount.toFixed(2)}
                </div>
              </div>
            </div>

            {/* VAT breakdown */}
            <div className="space-y-1 mb-4 mr-auto max-w-xs ml-0">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">חייב במע"מ:</span>
                <span>{beforeVat.toFixed(2)} ₪</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">מע"מ נגבה 18.00%:</span>
                <span>{vat.toFixed(2)} ₪</span>
              </div>
              <div className="flex justify-between bg-emerald-100 px-3 py-2 rounded font-bold">
                <span>סה"כ שקל:</span>
                <span>{formatILS(item.amount)}</span>
              </div>
            </div>

            {/* Payment */}
            <div className="border-t pt-3 text-sm space-y-1">
              <div className="font-semibold text-emerald-700">
                אופן התשלום:
              </div>
              <div className="flex justify-between">
                <span>העברה בנקאית</span>
                <span>{formatILS(item.amount)}</span>
              </div>
              <div className="font-semibold text-emerald-700 mt-2">פירוט:</div>
              <div className="bg-slate-50 px-3 py-2 rounded text-xs">
                תיאור העברה בנקאית | אסמכתא {item.asmachta ?? "—"} | תאריך{" "}
                {formatDateIL(item.bankDate)} | סכום {formatILS(item.amount)}
              </div>
            </div>

            {/* Optional note display */}
            {item.note && (
              <div className="mt-3 bg-amber-50 border border-amber-200 px-3 py-2 rounded text-xs">
                <span className="font-semibold">הערה לאישור:</span> {item.note}
              </div>
            )}

            {/* Source breakdown */}
            <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
              <div className="bg-blue-50 border border-blue-100 px-2 py-1.5 rounded">
                <span className="font-semibold">מהבנק:</span> שם • סכום •
                אסמכתא • תאריך
              </div>
              <div className="bg-purple-50 border border-purple-100 px-2 py-1.5 rounded">
                <span className="font-semibold">מ-Fireberry:</span> ת.ז. •
                נייד • תיאור
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="border-t bg-slate-50 px-4 py-2 flex items-center justify-between text-sm">
          <button
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0 || issuing}
            className="flex items-center gap-1 text-slate-600 hover:text-slate-900 disabled:opacity-40"
          >
            <ChevronRight className="w-4 h-4" /> הקודם
          </button>
          <span className="text-slate-600">
            חשבונית {idx + 1} מתוך {total}
          </span>
          <button
            onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}
            disabled={idx === total - 1 || issuing}
            className="flex items-center gap-1 text-slate-600 hover:text-slate-900 disabled:opacity-40"
          >
            הבא <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Action buttons */}
        <div className="border-t px-4 py-3 flex items-center justify-between bg-white">
          <div className="text-xs text-slate-500">
            ⚠ פעולה זו תפיק <b>{total}</b> חשבוניות אמיתיות ב-Cardcom — בלתי
            הפיכה.
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={issuing}
              className="px-4 py-2 rounded border border-slate-300 hover:bg-slate-50 text-sm"
            >
              ביטול
            </button>
            <button
              onClick={onConfirm}
              disabled={issuing}
              className="px-4 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 text-sm flex items-center gap-2"
            >
              {issuing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  מפיק...
                </>
              ) : (
                <>אשר והפק {total} חשבוניות</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
