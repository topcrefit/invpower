"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import {
  Upload,
  RefreshCcw,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Receipt,
  Loader2,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
} from "lucide-react";
import { formatDateIL, formatILS } from "@/lib/utils";

type Suggestion = {
  purchaseId: number;
  accountProductId: string;
  accountId: string | null;
  customerName: string | null;
  productName: string | null;
  price: number | null;
  customerTaxId: string | null;
  similarity: number;
  reason: string;
};

type Tx = {
  id: number;
  txDate: string;
  amount: number;
  reference: string | null;
  description: string | null;
  extractedName: string | null;
  extractedAccount: string | null;
  extendedDescription: string | null;
  ourIssued: {
    id: number;
    status: string;
    invoiceNumber: string | null;
    invoiceLink: string | null;
    uploadStatus: string;
  } | null;
  cardcomExisting: { invoiceNumber: string; reason: string } | null;
  suggestions: Suggestion[];
};

export default function DashboardClient({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  // selection: bankTxId → fireberryPurchaseId
  const [selected, setSelected] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(new Map());
    try {
      const res = await fetch(`/api/invoices/check?from=${from}&to=${to}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה בטעינה");
      setTransactions(j.transactions);

      // אוטומטית: בוחר את ההצעה הכי טובה אם יש בדיוק אחת
      const auto = new Map<number, number>();
      for (const t of j.transactions as Tx[]) {
        if (t.ourIssued || t.cardcomExisting) continue;
        if (t.suggestions.length === 1) {
          auto.set(t.id, t.suggestions[0].purchaseId);
        }
      }
      setSelected(auto);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  async function syncCardcom() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setResultMessage(`Cardcom סונכרן: ${j.created} חדשות, ${j.updated} עודכנו`);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בסנכרון");
    } finally {
      setWorking(false);
    }
  }

  async function syncFireberry() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/fireberry/sync-purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setResultMessage(`Fireberry סונכרן: ${j.created} חדשות, ${j.updated} עודכנו`);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בסנכרון");
    } finally {
      setWorking(false);
    }
  }

  async function onUpload(file: File) {
    setWorking(true);
    setError(null);
    setUploadInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/bank/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאת העלאה");
      if (j.duplicate) {
        setUploadInfo("הקובץ הזה כבר הועלה בעבר");
      } else {
        setUploadInfo(
          `הועלו ${j.inserted} שורות (${j.skipped} כפילויות). טווח: ${formatDateIL(j.dateFrom)} – ${formatDateIL(j.dateTo)}`
        );
        setFrom(j.dateFrom.slice(0, 10));
        setTo(j.dateTo.slice(0, 10));
      }
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאת העלאה");
    } finally {
      setWorking(false);
    }
  }

  function selectSuggestion(txId: number, purchaseId: number | null) {
    const n = new Map(selected);
    if (purchaseId === null) n.delete(txId);
    else n.set(txId, purchaseId);
    setSelected(n);
  }

  function toggleExpand(id: number) {
    const n = new Set(expanded);
    n.has(id) ? n.delete(id) : n.add(id);
    setExpanded(n);
  }

  async function issueSelected() {
    if (selected.size === 0) return;
    if (!confirm(`להפיק ${selected.size} חשבוניות מס-קבלה?`)) return;
    setWorking(true);
    setError(null);
    setResultMessage(null);
    try {
      const pairs = Array.from(selected.entries()).map(([bankTxId, purchaseId]) => ({
        bankTransactionId: bankTxId,
        fireberryPurchaseId: purchaseId,
      }));
      const res = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      const ok = j.results.filter((r: { status: string }) => r.status === "issued").length;
      const partial = j.results.filter((r: { status: string }) => r.status === "partial").length;
      const skipped = j.results.filter((r: { status: string }) => r.status === "skipped").length;
      const failed = j.results.filter((r: { status: string }) => r.status === "failed").length;
      setResultMessage(
        `✅ הופקו: ${ok} | ⚠️ חלקיות: ${partial} | ⏭ דולגו: ${skipped} | ❌ נכשלו: ${failed}`
      );
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בהפקה");
    } finally {
      setWorking(false);
    }
  }

  const stats = useMemo(() => {
    const total = transactions.length;
    const issued = transactions.filter((t) => t.ourIssued?.status === "issued").length;
    const partial = transactions.filter((t) => t.ourIssued?.status === "partial").length;
    const inCardcom = transactions.filter(
      (t) => !t.ourIssued && t.cardcomExisting
    ).length;
    const matched = transactions.filter(
      (t) => !t.ourIssued && !t.cardcomExisting && t.suggestions.length > 0
    ).length;
    const noMatch = transactions.filter(
      (t) => !t.ourIssued && !t.cardcomExisting && t.suggestions.length === 0
    ).length;
    const totalAmount = transactions.reduce((s, t) => s + t.amount, 0);
    return { total, issued, partial, inCardcom, matched, noMatch, totalAmount };
  }, [transactions]);

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">מתאריך</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input w-40"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">עד תאריך</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="input w-40"
              dir="ltr"
            />
          </div>
          <button onClick={loadList} className="btn-primary" disabled={loading || working}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            רענן
          </button>
          <button onClick={syncFireberry} className="btn-secondary" disabled={working}>
            <RefreshCcw className="w-4 h-4" />
            סנכרן Fireberry
          </button>
          <button onClick={syncCardcom} className="btn-secondary" disabled={working}>
            <RefreshCcw className="w-4 h-4" />
            סנכרן Cardcom
          </button>
          <label className="btn-outline cursor-pointer">
            <Upload className="w-4 h-4" />
            העלה Excel
            <input
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
              disabled={working}
            />
          </label>

          <div className="flex-1" />

          <button
            onClick={issueSelected}
            className="btn-primary"
            disabled={selected.size === 0 || working}
          >
            {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
            הפק {selected.size > 0 ? `(${selected.size})` : ""} חשבוניות
          </button>
        </div>

        {(uploadInfo || resultMessage || error) && (
          <div className="mt-3 space-y-1.5 text-sm">
            {uploadInfo && (
              <div className="flex items-center gap-2 text-blue-700 bg-blue-50 px-3 py-2 rounded-md">
                <FileSpreadsheet className="w-4 h-4" /> {uploadInfo}
              </div>
            )}
            {resultMessage && (
              <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 px-3 py-2 rounded-md">
                <CheckCircle2 className="w-4 h-4" /> {resultMessage}
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                <AlertTriangle className="w-4 h-4" /> {error}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Stat label="סה״כ תנועות" value={String(stats.total)} />
        <Stat label="הופקו" value={String(stats.issued)} tone="green" />
        <Stat label="חלקיות" value={String(stats.partial)} tone="amber" />
        <Stat label="קיים ב-Cardcom" value={String(stats.inCardcom)} tone="blue" />
        <Stat label="מומלץ להפיק" value={String(stats.matched)} tone="amber" />
        <Stat label="ללא match" value={String(stats.noMatch)} />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-340px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 z-10">
              <tr className="text-right">
                <th className="px-2 py-2 w-8"></th>
                <th className="px-2 py-2">תאריך</th>
                <th className="px-2 py-2">סכום</th>
                <th className="px-2 py-2">שם בנק</th>
                <th className="px-2 py-2">אסמכתא</th>
                <th className="px-2 py-2">התאמה ב-Fireberry</th>
                <th className="px-2 py-2">סטטוס</th>
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    אין תנועות. העלה Excel והרץ "סנכרן Fireberry".
                  </td>
                </tr>
              )}
              {transactions.map((t) => {
                const disabled = !!t.ourIssued || !!t.cardcomExisting;
                const isExpanded = expanded.has(t.id);
                const selectedPid = selected.get(t.id) ?? null;

                return (
                  <Fragment key={t.id}>
                    <tr className={`border-t hover:bg-slate-50 ${disabled ? "opacity-60" : ""}`}>
                      <td className="px-2 py-1.5 align-top">
                        {t.suggestions.length > 0 && !disabled && (
                          <button
                            onClick={() => toggleExpand(t.id)}
                            className="hover:bg-slate-200 rounded p-0.5"
                            title="הצג הצעות"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronLeft className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap align-top">
                        {formatDateIL(t.txDate)}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap font-medium align-top">
                        {formatILS(t.amount)}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <div>{t.extractedName ?? "—"}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">
                          {t.extractedAccount ?? ""}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-xs align-top" dir="ltr">
                        {t.reference ?? ""}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        {disabled ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : t.suggestions.length === 0 ? (
                          <span className="text-xs text-muted-foreground">לא נמצאה</span>
                        ) : (
                          <SuggestionPicker
                            suggestions={t.suggestions}
                            selected={selectedPid}
                            onSelect={(pid) => selectSuggestion(t.id, pid)}
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <StatusBadge tx={t} />
                      </td>
                    </tr>
                    {isExpanded && t.suggestions.length > 1 && (
                      <tr className="bg-slate-50 border-t">
                        <td colSpan={7} className="px-4 py-2">
                          <div className="text-xs text-muted-foreground mb-1">
                            כל ההתאמות ({t.suggestions.length}):
                          </div>
                          <div className="space-y-1">
                            {t.suggestions.map((s) => (
                              <label
                                key={s.purchaseId}
                                className="flex items-center gap-3 text-sm cursor-pointer hover:bg-white p-1 rounded"
                              >
                                <input
                                  type="radio"
                                  name={`tx-${t.id}`}
                                  checked={selectedPid === s.purchaseId}
                                  onChange={() => selectSuggestion(t.id, s.purchaseId)}
                                />
                                <span className="font-medium">{s.customerName}</span>
                                <span className="text-xs text-muted-foreground">
                                  {s.productName ?? ""}
                                </span>
                                <span className="text-xs">
                                  ת.ז. {s.customerTaxId ?? "—"}
                                </span>
                                <span className="text-xs text-blue-700">
                                  {(s.similarity * 100).toFixed(0)}%
                                </span>
                                <span className="text-xs text-muted-foreground">{s.reason}</span>
                              </label>
                            ))}
                            <button
                              onClick={() => selectSuggestion(t.id, null)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              ביטול בחירה
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SuggestionPicker({
  suggestions,
  selected,
  onSelect,
}: {
  suggestions: Suggestion[];
  selected: number | null;
  onSelect: (pid: number | null) => void;
}) {
  const top = suggestions[0];
  const isSelected = selected === top.purchaseId;
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onSelect(isSelected ? null : top.purchaseId)}
      />
      <div className="text-xs">
        <div className="font-medium">{top.customerName ?? "—"}</div>
        <div className="text-muted-foreground">
          {top.productName ?? ""} · ת.ז. {top.customerTaxId ?? "—"} ·{" "}
          <span className="text-blue-700">{(top.similarity * 100).toFixed(0)}%</span>
          {suggestions.length > 1 && <span className="text-amber-700"> · +{suggestions.length - 1} נוספות</span>}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "blue" | "amber";
}) {
  const tones = {
    green: "border-emerald-200 bg-emerald-50",
    blue: "border-blue-200 bg-blue-50",
    amber: "border-amber-200 bg-amber-50",
  } as const;
  return (
    <div className={`card p-2 ${tone ? tones[tone] : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-bold">{value}</div>
    </div>
  );
}

function StatusBadge({ tx }: { tx: Tx }) {
  if (tx.ourIssued) {
    const s = tx.ourIssued;
    if (s.status === "issued") {
      return (
        <div className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="w-3 h-3" />
            הופק {s.invoiceNumber}
          </span>
          {s.invoiceLink && (
            <a
              href={s.invoiceLink}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:text-blue-800"
              title="פתח PDF"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      );
    }
    if (s.status === "partial") {
      return (
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"
          title={`Cardcom OK / Fireberry: ${s.uploadStatus}`}
        >
          <AlertTriangle className="w-3 h-3" /> חלקי {s.invoiceNumber}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
        <AlertTriangle className="w-3 h-3" /> נכשל
      </span>
    );
  }
  if (tx.cardcomExisting) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"
        title={tx.cardcomExisting.reason}
      >
        קיים ב-Cardcom #{tx.cardcomExisting.invoiceNumber}
      </span>
    );
  }
  if (tx.suggestions.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
        ללא match
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
      ממתין להפקה
    </span>
  );
}
