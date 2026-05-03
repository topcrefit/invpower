"use client";

import { useState } from "react";
import {
  Search,
  Loader2,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ExternalLink,
  Banknote,
  Building2,
  FileText,
  PackageCheck,
} from "lucide-react";
import { formatDateIL, formatILS } from "@/lib/utils";

type BankRow = {
  id: number;
  txDate: string;
  reference: string | null;
  amount: number;
  description: string | null;
  extractedName: string | null;
  extractedAccount: string | null;
  extendedDescription: string | null;
  linkedInvoice: string | null;
};
type FbRow = {
  id: number;
  accountProductId: string;
  accountId: string | null;
  productName: string | null;
  price: number | null;
  customerName: string | null;
  customerTaxId: string | null;
  customerPhone: string | null;
  paymentTypeName: string | null;
  invoiceStatusName: string | null;
  createdOn: string | null;
};
type CcRow = {
  id: number;
  invoiceNumber: string;
  invoiceType: number | null;
  invoiceDate: string | null;
  totalIncludeVat: number | null;
  customerName: string | null;
  customerId: string | null;
  phone: string | null;
  email: string | null;
  asmachta: string | null;
};
type IssuedRow = {
  id: number;
  bankTransactionId: number;
  cardcomInvoiceNumber: string | null;
  cardcomInvoiceLink: string | null;
  customerName: string;
  customerTaxId: string | null;
  amount: number;
  asmachta: string | null;
  txDate: string;
  issuedAt: string | null;
  productName: string | null;
  status: string;
};

type Result = {
  ok: boolean;
  query: string;
  mode: "tax_id" | "phone" | "reference" | "name" | "empty";
  banks: BankRow[];
  fireberry: FbRow[];
  cardcom: CcRow[];
  issued: IssuedRow[];
  summary: {
    banks: number;
    fireberry: number;
    cardcom: number;
    issued: number;
  };
};

function modeLabel(mode: Result["mode"]) {
  switch (mode) {
    case "tax_id": return "ת.ז.";
    case "phone": return "טלפון";
    case "reference": return "אסמכתא / מספר חשבונית";
    case "name": return "שם (חיפוש מקורב)";
    default: return "";
  }
}

function invoiceTypeName(t: number | null): string {
  if (t == null) return "";
  switch (t) {
    case 1: return "חשבונית מס קבלה";
    case 2: return "קבלה";
    case 3: return "חשבונית מס";
    case 4: return "קבלה זיכוי";
    case 305: return "חשבונית עסקה";
    case 330: return "חשבונית מס קבלה זיכוי";
    default: return `סוג ${t}`;
  }
}

export default function SearchClient() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState({ bank: true, fb: true, cc: true, issued: true });

  async function search(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/search/customer?q=${encodeURIComponent(q.trim())}`
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const j = (await res.json()) as Result;
      setResult(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="flex items-center gap-3 mb-4">
        <Search className="w-6 h-6 text-blue-700" />
        <h1 className="text-2xl font-bold">חיפוש לקוח</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        חיפוש חוצה-מערכות: שם, ת.ז., או טלפון. החיפוש מאתר את הלקוח בבנק,
        ב-Fireberry, ב-Cardcom וברשימת החשבוניות שהמערכת הפיקה.
      </p>

      <form onSubmit={search} className="flex gap-2 mb-6">
        <div className="relative">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="שם / ת.ז. / טלפון / אסמכתא"
            maxLength={30}
            className="w-[30ch] border rounded-md pr-10 pl-3 py-2.5 text-sm"
            autoFocus
          />
        </div>
        <button
          type="submit"
          disabled={busy || q.trim().length < 2}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 rounded-md font-medium flex items-center gap-2"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          חפש
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {result && (
        <>
          {/* Header summary */}
          <div className="bg-slate-50 rounded-md px-4 py-3 mb-5 text-sm flex items-center gap-4 flex-wrap">
            <span>
              חיפוש לפי{" "}
              <span className="font-semibold">{modeLabel(result.mode)}</span>
            </span>
            <span className="text-muted-foreground">|</span>
            <span>
              <Banknote className="inline w-4 h-4 ml-1" />
              {result.summary.banks} תנועות בנק
            </span>
            <span>
              <Building2 className="inline w-4 h-4 ml-1" />
              {result.summary.fireberry} ב-Fireberry
            </span>
            <span>
              <FileText className="inline w-4 h-4 ml-1" />
              {result.summary.cardcom} חשבוניות Cardcom
            </span>
            <span>
              <PackageCheck className="inline w-4 h-4 ml-1" />
              {result.summary.issued} הופקו במערכת
            </span>
          </div>

          {/* Issued invoices first — these are the strongest connections */}
          {result.issued.length > 0 && (
            <Section
              title={`הופקו במערכת (${result.issued.length})`}
              icon={<PackageCheck className="w-5 h-5 text-emerald-700" />}
              open={open.issued}
              onToggle={() => setOpen((s) => ({ ...s, issued: !s.issued }))}
            >
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs">
                  <tr>
                    <th className="px-2 py-1.5 text-right">חשבונית</th>
                    <th className="px-2 py-1.5 text-right">תאריך הפקה</th>
                    <th className="px-2 py-1.5 text-right">שם</th>
                    <th className="px-2 py-1.5 text-right">סכום</th>
                    <th className="px-2 py-1.5 text-right">מוצר</th>
                    <th className="px-2 py-1.5 text-right">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {result.issued.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-medium">
                        {r.cardcomInvoiceNumber ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                        {r.issuedAt ? formatDateIL(r.issuedAt) : "—"}
                      </td>
                      <td className="px-2 py-1.5">{r.customerName}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {formatILS(r.amount)}
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {r.productName ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.cardcomInvoiceLink ? (
                          <a
                            href={r.cardcomInvoiceLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1"
                          >
                            פתח <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* Bank transactions */}
          <Section
            title={`תנועות בנק (${result.banks.length})`}
            icon={<Banknote className="w-5 h-5 text-blue-700" />}
            open={open.bank}
            onToggle={() => setOpen((s) => ({ ...s, bank: !s.bank }))}
          >
            {result.banks.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 px-2">
                לא נמצאו תנועות.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs">
                  <tr>
                    <th className="px-2 py-1.5 text-right">תאריך</th>
                    <th className="px-2 py-1.5 text-right">אסמכתא</th>
                    <th className="px-2 py-1.5 text-right">שם בבנק</th>
                    <th className="px-2 py-1.5 text-right">חשבון</th>
                    <th className="px-2 py-1.5 text-right">סכום</th>
                    <th className="px-2 py-1.5 text-right">חשבונית</th>
                  </tr>
                </thead>
                <tbody>
                  {result.banks.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-slate-50">
                      <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                        {formatDateIL(r.txDate)}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                        {r.reference ?? "—"}
                      </td>
                      <td className="px-2 py-1.5">{r.extractedName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                        {r.extractedAccount ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap font-medium">
                        {formatILS(r.amount)}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {r.linkedInvoice ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />#
                            {r.linkedInvoice}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Fireberry */}
          <Section
            title={`Fireberry (${result.fireberry.length})`}
            icon={<Building2 className="w-5 h-5 text-indigo-700" />}
            open={open.fb}
            onToggle={() => setOpen((s) => ({ ...s, fb: !s.fb }))}
          >
            {result.fireberry.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 px-2">
                לא נמצאו רשומות.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs">
                  <tr>
                    <th className="px-2 py-1.5 text-right">תאריך</th>
                    <th className="px-2 py-1.5 text-right">שם</th>
                    <th className="px-2 py-1.5 text-right">ת.ז.</th>
                    <th className="px-2 py-1.5 text-right">טלפון</th>
                    <th className="px-2 py-1.5 text-right">מוצר</th>
                    <th className="px-2 py-1.5 text-right">סכום</th>
                    <th className="px-2 py-1.5 text-right">סטטוס</th>
                    <th className="px-2 py-1.5 text-right">תשלום</th>
                  </tr>
                </thead>
                <tbody>
                  {result.fireberry.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-slate-50">
                      <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                        {r.createdOn ? formatDateIL(r.createdOn) : "—"}
                      </td>
                      <td className="px-2 py-1.5">{r.customerName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {r.customerTaxId ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {r.customerPhone ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {r.productName ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap font-medium">
                        {r.price != null ? formatILS(r.price) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        <span
                          className={
                            r.invoiceStatusName === "נשלח"
                              ? "text-emerald-700"
                              : r.invoiceStatusName === "לא נשלח"
                                ? "text-amber-700"
                                : "text-muted-foreground"
                          }
                        >
                          {r.invoiceStatusName ?? "—"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-xs text-muted-foreground">
                        {r.paymentTypeName ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          {/* Cardcom */}
          <Section
            title={`Cardcom (${result.cardcom.length})`}
            icon={<FileText className="w-5 h-5 text-orange-700" />}
            open={open.cc}
            onToggle={() => setOpen((s) => ({ ...s, cc: !s.cc }))}
          >
            {result.cardcom.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 px-2">
                לא נמצאו חשבוניות.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-xs">
                  <tr>
                    <th className="px-2 py-1.5 text-right">חשבונית</th>
                    <th className="px-2 py-1.5 text-right">תאריך</th>
                    <th className="px-2 py-1.5 text-right">סוג</th>
                    <th className="px-2 py-1.5 text-right">שם</th>
                    <th className="px-2 py-1.5 text-right">ת.ז.</th>
                    <th className="px-2 py-1.5 text-right">סכום</th>
                    <th className="px-2 py-1.5 text-right">אסמכתא</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cardcom.map((r) => (
                    <tr key={r.id} className="border-t hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-medium">
                        {r.invoiceNumber}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-xs">
                        {r.invoiceDate ? formatDateIL(r.invoiceDate) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs">
                        {invoiceTypeName(r.invoiceType)}
                      </td>
                      <td className="px-2 py-1.5">{r.customerName ?? "—"}</td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {r.customerId?.trim() ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap font-medium">
                        {r.totalIncludeVat != null
                          ? formatILS(r.totalIncludeVat)
                          : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                        {r.asmachta ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}

      {!result && !busy && (
        <div className="text-center text-muted-foreground py-12">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
          הקלד שם, ת.ז. או טלפון כדי להתחיל.
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 bg-white rounded-lg border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2 font-semibold">
          {icon}
          <span>{title}</span>
        </div>
        {open ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>
      {open && <div className="overflow-x-auto">{children}</div>}
    </div>
  );
}
