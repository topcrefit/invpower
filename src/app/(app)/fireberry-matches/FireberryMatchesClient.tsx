"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCcw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import { formatDateIL, formatILS } from "@/lib/utils";
import InvoicePreviewModal, {
  type InvoicePreviewItem,
} from "./InvoicePreviewModal";

type BankCandidate = {
  bankTransactionId: number;
  txDate: string;
  amount: number;
  extractedName: string | null;
  extractedAccount: string | null;
  reference: string | null;
  description: string | null;
  nameSimilarity: number;
  daysDiff: number;
  reason: string;
};

type BankMatch = BankCandidate & {
  confidence: "high" | "medium";
  approved?: boolean;
  note?: string | null;
};

type RowResult = {
  purchaseId: number;
  accountProductId: string;
  customerName: string | null;
  productName: string | null;
  invoiceLinesDescription: string | null;
  price: number | null;
  createdOn: string | null;
  invoiceStatusName: string | null;
  paymentTypeName: string | null;
  customerTaxId: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  bank: BankMatch | null;
  candidates: BankCandidate[];
};

type Summary = {
  total: number;
  high: number;
  medium: number;
  unmatched: number;
  totalAmount: number;
  matchedAmount: number;
  unmatchedAmount: number;
};

type FilterKey = "all" | "candidates" | "unmatched";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthsAgoISO(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export default function FireberryMatchesClient() {
  const [rows, setRows] = useState<RowResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [from, setFrom] = useState<string>(monthsAgoISO(1));
  const [to, setTo] = useState<string>(todayISO());
  const [windowDays, setWindowDays] = useState<number>(60);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});
  const [issueSelected, setIssueSelected] = useState<Set<number>>(new Set());
  const [issuing, setIssuing] = useState(false);
  const [issueResults, setIssueResults] = useState<
    Record<
      number,
      {
        status: "issued" | "skipped" | "failed" | "partial";
        message: string;
        invoiceNumber?: string;
        invoiceLink?: string;
      }
    >
  >({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<InvoicePreviewItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from,
        to,
        window: String(windowDays),
      });
      const res = await fetch(
        `/api/reconcile/fireberry-vs-bank?${params.toString()}`
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה בטעינה");
      setRows(j.rows);
      setSummary(j.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }, [from, to, windowDays]);

  useEffect(() => {
    load();
  }, [load]);

  async function syncFireberry() {
    setSyncing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/fireberry/sync-purchases", {
        method: "POST",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה בסנכרון");
      setInfo(
        `סונכרנו ${j.total ?? j.created ?? j.upserted ?? j.fetched ?? 0} רכישות מ-Fireberry`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בסנכרון");
    } finally {
      setSyncing(false);
    }
  }

  async function approveMatch(
    bankTransactionId: number,
    fireberryPurchaseId: number,
    note?: string
  ) {
    setApproving(fireberryPurchaseId);
    setError(null);
    try {
      const res = await fetch("/api/reconcile/approve-fireberry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankTransactionId,
          fireberryPurchaseId,
          note: note ?? null,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה באישור");
    } finally {
      setApproving(null);
    }
  }

  async function issueInvoices(
    pairs: Array<{ bankTransactionId: number; fireberryPurchaseId: number }>
  ) {
    if (pairs.length === 0) return;
    setIssuing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה בהפקה");
      const updates: typeof issueResults = {};
      let issued = 0;
      let skipped = 0;
      let failed = 0;
      for (const r of j.results as Array<{
        bankTransactionId: number;
        fireberryPurchaseId: number;
        status: "issued" | "skipped" | "failed" | "partial";
        message: string;
        invoiceNumber?: string;
        invoiceLink?: string;
      }>) {
        updates[r.fireberryPurchaseId] = {
          status: r.status,
          message: r.message,
          invoiceNumber: r.invoiceNumber,
          invoiceLink: r.invoiceLink,
        };
        if (r.status === "issued" || r.status === "partial") issued++;
        else if (r.status === "skipped") skipped++;
        else failed++;
      }
      setIssueResults((prev) => ({ ...prev, ...updates }));
      setIssueSelected(new Set());
      setInfo(`הופקו: ${issued} | דולגו: ${skipped} | נכשלו: ${failed}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setIssuing(false);
    }
  }

  async function issueOne(
    bankTransactionId: number,
    fireberryPurchaseId: number
  ) {
    // פותח את אותו מודאל תצוגה מקדימה עם שורה אחת בלבד
    const r = rows.find((x) => x.purchaseId === fireberryPurchaseId);
    if (!r || !r.bank) return;
    setPreviewItems([
      {
        purchaseId: r.purchaseId,
        bankTransactionId,
        customerName: r.bank.extractedName ?? r.customerName ?? "לקוח לא מזוהה",
        customerTaxId: r.customerTaxId,
        customerPhone: r.customerPhone,
        customerEmail: r.customerEmail,
        productDescription:
          r.invoiceLinesDescription ?? r.productName ?? "תשלום",
        amount: r.bank.amount,
        asmachta: r.bank.reference,
        bankDate: r.bank.txDate,
        isMedium: r.bank.confidence === "medium" && !r.bank.approved,
        note: noteDraft[r.purchaseId] ?? "",
      },
    ]);
    setPreviewOpen(true);
  }

  function openPreview() {
    const items: InvoicePreviewItem[] = [];
    for (const r of rows) {
      if (!issueSelected.has(r.purchaseId)) continue;
      if (!r.bank) continue;
      items.push({
        purchaseId: r.purchaseId,
        bankTransactionId: r.bank.bankTransactionId,
        customerName: r.bank.extractedName ?? r.customerName ?? "לקוח לא מזוהה",
        customerTaxId: r.customerTaxId,
        customerPhone: r.customerPhone,
        customerEmail: r.customerEmail,
        productDescription:
          r.invoiceLinesDescription ?? r.productName ?? "תשלום",
        amount: r.bank.amount,
        asmachta: r.bank.reference,
        bankDate: r.bank.txDate,
        isMedium: r.bank.confidence === "medium" && !r.bank.approved,
        note: noteDraft[r.purchaseId] ?? "",
      });
    }
    if (items.length === 0) return;
    setPreviewItems(items);
    setPreviewOpen(true);
  }

  async function confirmAndIssue() {
    // 1. אישור חלקיות שלא אושרו עדיין (approve-fireberry)
    const toApprove = previewItems.filter((i) => i.isMedium);
    if (toApprove.length > 0) {
      try {
        await fetch("/api/reconcile/approve-fireberry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: toApprove.map((i) => ({
              bankTransactionId: i.bankTransactionId,
              fireberryPurchaseId: i.purchaseId,
              note: i.note || null,
            })),
          }),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "שגיאה באישור");
        return;
      }
    }

    // 2. הפקה ב-Cardcom
    const pairs = previewItems.map((i) => ({
      bankTransactionId: i.bankTransactionId,
      fireberryPurchaseId: i.purchaseId,
    }));
    await issueInvoices(pairs);
    setPreviewOpen(false);
    setPreviewItems([]);
  }

  async function issueBulk() {
    openPreview();
  }

  function toggleIssueSelect(id: number) {
    setIssueSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function unapproveMatch(bankTransactionId: number) {
    if (!confirm("לבטל את האישור?")) return;
    setApproving(bankTransactionId);
    try {
      const res = await fetch(
        `/api/reconcile/approve-fireberry?bankTransactionId=${bankTransactionId}`,
        { method: "DELETE" }
      );
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setApproving(null);
    }
  }

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "unmatched") return rows.filter((r) => !r.bank);
    if (filter === "candidates") return rows.filter((r) => !!r.bank);
    return rows;
  }, [rows, filter]);

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <div className="text-xs text-muted-foreground mb-1">מתאריך</div>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">עד תאריך</div>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">חלון ± ימים</div>
          <input
            type="number"
            min={1}
            max={120}
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value) || 60)}
            className="input w-24"
          />
        </div>
        <button
          onClick={load}
          className="btn-primary"
          disabled={loading || syncing}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCcw className="w-4 h-4" />
          )}
          רענן
        </button>
        <button
          onClick={syncFireberry}
          className="btn-secondary"
          disabled={loading || syncing}
        >
          {syncing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCcw className="w-4 h-4" />
          )}
          סנכרן Fireberry
        </button>
        <div className="flex-1" />
        <a
          href="/dashboard"
          className="text-sm text-blue-600 hover:underline"
        >
          ← שלב א׳: בנק ↔ Cardcom
        </a>
      </div>

      <div className="card p-3">
        <div className="text-sm font-semibold mb-1">
          רכישות Fireberry → בנק
        </div>
        <div className="text-xs text-muted-foreground">
          לכל רכישה ב-Fireberry (לפי 4 הפילטרים): האם הגיע הכסף בבנק? התאמה
          ודאית = מוכן להפקת חשבונית. ⚠ "טרם התקבל" = הכסף עדיין לא ירד בבנק
          בטווח התאריכים.
        </div>
      </div>

      {info && (
        <div className="flex items-center gap-2 text-blue-700 bg-blue-50 px-3 py-2 rounded-md">
          <CheckCircle2 className="w-4 h-4" /> {info}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-destructive bg-destructive/10 px-3 py-2 rounded-md">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <FilterCard
            label="סה״כ רכישות"
            value={summary.total}
            sub={formatILS(summary.totalAmount)}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterCard
            label="מועמדות להפקה (ודאית + חלקית)"
            value={summary.high + summary.medium}
            sub={formatILS(summary.matchedAmount)}
            tone="green"
            active={filter === "candidates"}
            onClick={() =>
              setFilter(filter === "candidates" ? "all" : "candidates")
            }
          />
          <FilterCard
            label="טרם התקבל"
            value={summary.unmatched}
            sub={`חוסר: ${formatILS(summary.unmatchedAmount)}`}
            tone="red"
            active={filter === "unmatched"}
            onClick={() =>
              setFilter(filter === "unmatched" ? "all" : "unmatched")
            }
          />
        </div>
      )}

      {(() => {
        const issuableRows = rows.filter(
          (r) =>
            r.bank &&
            issueResults[r.purchaseId]?.status !== "issued"
        );
        const allIssuableSelected =
          issuableRows.length > 0 &&
          issuableRows.every((r) => issueSelected.has(r.purchaseId));
        if (issuableRows.length === 0) return null;
        return (
          <div className="card p-3 bg-emerald-50 border-emerald-200 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allIssuableSelected}
                onChange={(e) => {
                  if (e.target.checked) {
                    setIssueSelected(
                      new Set(issuableRows.map((r) => r.purchaseId))
                    );
                  } else {
                    setIssueSelected(new Set());
                  }
                }}
              />
              בחר הכל ({issuableRows.length} מועמדות להפקה)
            </label>
            <button
              onClick={issueBulk}
              disabled={issuing || issueSelected.size === 0}
              className="btn-primary text-sm"
            >
              {issuing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              תצוגה מקדימה והפקה ({issueSelected.size})
            </button>
          </div>
        );
      })()}

      <div className="card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-340px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 z-10">
              <tr className="text-right">
                <th className="px-2 py-2 w-8"></th>
                <th className="px-2 py-2 w-8"></th>
                <th className="px-2 py-2">סטטוס</th>
                <th className="px-2 py-2">נוצר ב-Fireberry</th>
                <th className="px-2 py-2">לקוח (Fireberry)</th>
                <th className="px-2 py-2">סכום</th>
                <th className="px-2 py-2 border-r-2 border-slate-300">
                  → תנועה בבנק
                </th>
                <th className="px-2 py-2">לקוח (בנק)</th>
                <th className="px-2 py-2">סיבה</th>
                <th className="px-2 py-2">חשבונית</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td
                    colSpan={11}
                    className="text-center py-8 text-muted-foreground"
                  >
                    אין שורות להצגה
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const isExpanded = expanded.has(r.purchaseId);
                const hasCandidates = r.candidates.length > 0;
                const issueRes = issueResults[r.purchaseId];
                const isIssuable = !!r.bank && issueRes?.status !== "issued";
                return (
                  <FragmentRow
                    key={r.purchaseId}
                    r={r}
                    isExpanded={isExpanded}
                    hasCandidates={hasCandidates}
                    approving={approving === r.purchaseId}
                    noteDraft={noteDraft[r.purchaseId] ?? ""}
                    isIssuable={isIssuable}
                    issueSelected={issueSelected.has(r.purchaseId)}
                    issuing={issuing}
                    issueResult={issueRes}
                    onToggle={() => toggleExpanded(r.purchaseId)}
                    onApprove={(bankTxId, note) =>
                      approveMatch(bankTxId, r.purchaseId, note)
                    }
                    onUnapprove={() => {
                      if (r.bank)
                        unapproveMatch(r.bank.bankTransactionId);
                    }}
                    onNoteChange={(v) =>
                      setNoteDraft((prev) => ({
                        ...prev,
                        [r.purchaseId]: v,
                      }))
                    }
                    onToggleIssueSelect={() =>
                      toggleIssueSelect(r.purchaseId)
                    }
                    onIssueOne={() => {
                      if (r.bank)
                        issueOne(r.bank.bankTransactionId, r.purchaseId);
                    }}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {previewOpen && (
        <InvoicePreviewModal
          items={previewItems}
          onClose={() => {
            if (!issuing) {
              setPreviewOpen(false);
              setPreviewItems([]);
            }
          }}
          onConfirm={confirmAndIssue}
          issuing={issuing}
        />
      )}
    </div>
  );
}

function FragmentRow({
  r,
  isExpanded,
  hasCandidates,
  approving,
  noteDraft,
  isIssuable,
  issueSelected,
  issuing,
  issueResult,
  onToggle,
  onApprove,
  onUnapprove,
  onNoteChange,
  onToggleIssueSelect,
  onIssueOne,
}: {
  r: RowResult;
  isExpanded: boolean;
  hasCandidates: boolean;
  approving: boolean;
  noteDraft: string;
  isIssuable: boolean;
  issueSelected: boolean;
  issuing: boolean;
  issueResult?: {
    status: "issued" | "skipped" | "failed" | "partial";
    message: string;
    invoiceNumber?: string;
    invoiceLink?: string;
  };
  onToggle: () => void;
  onApprove: (bankTxId: number, note?: string) => void;
  onUnapprove: () => void;
  onNoteChange: (v: string) => void;
  onToggleIssueSelect: () => void;
  onIssueOne: () => void;
}) {
  return (
    <>
      <tr className="border-t hover:bg-slate-50">
        <td className="px-2 py-1.5 align-top">
          {isIssuable && (
            <input
              type="checkbox"
              checked={issueSelected}
              onChange={onToggleIssueSelect}
              disabled={issuing}
              title="סמן להפקת חשבונית"
            />
          )}
        </td>
        <td className="px-2 py-1.5 align-top">
          {(hasCandidates || r.bank) && (
            <button
              onClick={onToggle}
              className="text-slate-500 hover:text-slate-800"
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          )}
        </td>
        <td className="px-2 py-1.5 align-top whitespace-nowrap">
          <ConfidenceBadge match={r.bank} />
        </td>
        <td className="px-2 py-1.5 align-top whitespace-nowrap text-xs">
          {r.createdOn ? formatDateIL(r.createdOn) : "—"}
        </td>
        <td className="px-2 py-1.5 align-top">{r.customerName ?? "—"}</td>
        <td className="px-2 py-1.5 align-top whitespace-nowrap font-medium">
          {r.price != null ? formatILS(r.price) : "—"}
        </td>
        <td className="px-2 py-1.5 align-top whitespace-nowrap text-xs border-r-2 border-slate-300">
          {r.bank ? (
            <span>{formatDateIL(r.bank.txDate)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-2 py-1.5 align-top">
          {r.bank?.extractedName ?? "—"}
        </td>
        <td className="px-2 py-1.5 align-top text-xs text-muted-foreground">
          {r.bank?.reason ?? "טרם התקבל בבנק"}
        </td>
        <td className="px-2 py-1.5 align-top whitespace-nowrap text-xs">
          {issueResult ? (
            issueResult.invoiceLink ? (
              <a
                href={issueResult.invoiceLink}
                target="_blank"
                rel="noreferrer"
                className={`inline-flex items-center gap-1 hover:underline ${
                  issueResult.status === "issued"
                    ? "text-emerald-700"
                    : issueResult.status === "skipped"
                      ? "text-slate-600"
                      : "text-red-600"
                }`}
                title={issueResult.message}
              >
                {issueResult.status === "issued"
                  ? "✓"
                  : issueResult.status === "skipped"
                    ? "⏭"
                    : "✗"}{" "}
                #{issueResult.invoiceNumber ?? "—"}
              </a>
            ) : (
              <span
                className={`${
                  issueResult.status === "issued"
                    ? "text-emerald-700"
                    : issueResult.status === "skipped"
                      ? "text-slate-600"
                      : "text-red-600"
                }`}
                title={issueResult.message}
              >
                {issueResult.status === "issued"
                  ? `✓ #${issueResult.invoiceNumber}`
                  : issueResult.status === "skipped"
                    ? `⏭ ${issueResult.invoiceNumber ?? ""}`
                    : "✗ נכשלה"}
              </span>
            )
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-2 py-1.5 align-top whitespace-nowrap">
          {isIssuable && !issueResult && (
            <button
              onClick={onIssueOne}
              disabled={issuing}
              className="text-xs text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
              title="הפק חשבונית"
            >
              {issuing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3 h-3" />
              )}
              הפק
            </button>
          )}
          {r.bank?.approved ? (
            <button
              onClick={onUnapprove}
              disabled={approving}
              className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1 mr-2"
              title="בטל אישור"
            >
              <X className="w-3 h-3" /> בטל
            </button>
          ) : r.bank?.confidence === "medium" ? (
            <button
              onClick={() =>
                onApprove(r.bank!.bankTransactionId, noteDraft || undefined)
              }
              disabled={approving}
              className="text-xs text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 mr-2"
            >
              {approving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3 h-3" />
              )}
              אשר
            </button>
          ) : null}
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-slate-50">
          <td colSpan={11} className="px-4 py-3">
            <div className="space-y-2">
              {r.bank && r.bank.confidence === "medium" && !r.bank.approved && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="הערה (אופציונלי)"
                    value={noteDraft}
                    onChange={(e) => onNoteChange(e.target.value)}
                    className="input text-xs flex-1"
                  />
                  <button
                    onClick={() =>
                      onApprove(
                        r.bank!.bankTransactionId,
                        noteDraft || undefined
                      )
                    }
                    disabled={approving}
                    className="btn-primary text-xs"
                  >
                    אשר עם הערה
                  </button>
                </div>
              )}

              {r.candidates.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">
                    תנועות בנק מועמדות:
                  </div>
                  <div className="space-y-1">
                    {r.candidates.map((c) => (
                      <div
                        key={c.bankTransactionId}
                        className="flex items-center gap-2 bg-white rounded px-2 py-1 text-xs"
                      >
                        <span className="font-medium">
                          {c.extractedName ?? "—"}
                        </span>
                        <span className="text-muted-foreground">
                          {formatILS(c.amount)}
                        </span>
                        <span className="text-muted-foreground">
                          {formatDateIL(c.txDate)}
                        </span>
                        <span className="text-muted-foreground">
                          {c.reason}
                        </span>
                        <div className="flex-1" />
                        <button
                          onClick={() =>
                            onApprove(
                              c.bankTransactionId,
                              noteDraft || undefined
                            )
                          }
                          disabled={approving}
                          className="text-emerald-700 hover:text-emerald-900"
                        >
                          אשר זה
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ConfidenceBadge({ match }: { match: BankMatch | null }) {
  if (!match) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
        <HelpCircle className="w-3 h-3" /> טרם התקבל
      </span>
    );
  }
  if (match.confidence === "high") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="w-3 h-3" /> התקבל
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
      <AlertTriangle className="w-3 h-3" /> חלקית
    </span>
  );
}

function FilterCard({
  label,
  value,
  sub,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "green" | "amber" | "red";
  active: boolean;
  onClick: () => void;
}) {
  const tones = {
    green: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card p-2 text-right transition cursor-pointer hover:brightness-95 ${
        tone ? tones[tone] : ""
      } ${active ? "ring-2 ring-blue-500" : ""}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </button>
  );
}
