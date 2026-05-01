"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  Upload,
  RefreshCcw,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronLeft,
  HelpCircle,
  Check,
  X,
} from "lucide-react";
import { formatDateIL, formatILS } from "@/lib/utils";

type Match = {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string | null;
  customerId: string | null;
  totalIncludeVat: number | null;
  nameSimilarity: number;
  daysDiff: number;
  confidence: "high" | "medium";
  reason: string;
  approved?: boolean;
  note?: string | null;
};

type Candidate = {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string | null;
  customerId: string | null;
  totalIncludeVat: number | null;
  nameSimilarity: number;
  daysDiff: number;
  reason: string;
};

type Row = {
  id: number;
  txDate: string;
  amount: number;
  extractedName: string | null;
  extractedAccount: string | null;
  reference: string | null;
  description: string | null;
  match: Match | null;
  noInvoiceApproval: { reason: string; approvedAt: string } | null;
  candidates: Candidate[];
};

type Summary = {
  total: number;
  high: number;
  medium: number;
  noInvoice: number;
  unmatched: number;
  totalAmount: number;
  matchedAmount: number;
  unmatchedAmount: number;
};

type FilterKey = "all" | "high" | "medium" | "noInvoice" | "unmatched";

export default function DashboardClient({
  defaultFrom,
  defaultTo,
}: {
  defaultFrom: string;
  defaultTo: string;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [windowDays, setWindowDays] = useState(60);
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [approving, setApproving] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [noInvDraft, setNoInvDraft] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/reconcile/bank-vs-cardcom?from=${from}&to=${to}&window=${windowDays}`
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

  async function syncCardcom() {
    setWorking(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/invoices/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setInfo(`Cardcom סונכרן: ${j.created} חדשות, ${j.updated} עודכנו`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בסנכרון");
    } finally {
      setWorking(false);
    }
  }

  async function onUploadBank(file: File) {
    setWorking(true);
    setError(null);
    setInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/bank/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאת העלאה");
      if (j.duplicate) {
        setInfo("הקובץ הזה כבר הועלה בעבר");
      } else {
        setInfo(
          `הועלו ${j.inserted} שורות (${j.skipped} כפילויות). טווח: ${formatDateIL(j.dateFrom)} – ${formatDateIL(j.dateTo)}`
        );
        setFrom(j.dateFrom.slice(0, 10));
        setTo(j.dateTo.slice(0, 10));
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאת העלאה");
    } finally {
      setWorking(false);
    }
  }

  async function onImportCardcomExcel(file: File) {
    setWorking(true);
    setError(null);
    setInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/cardcom/import-excel", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה בייבוא");
      setInfo(
        `יובאו ${j.parsed} חשבוניות מ-Cardcom. טווח: ${formatDateIL(j.dateFrom)} – ${formatDateIL(j.dateTo)}`
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בייבוא");
    } finally {
      setWorking(false);
    }
  }

  function toggleExpand(id: number) {
    const n = new Set(expanded);
    n.has(id) ? n.delete(id) : n.add(id);
    setExpanded(n);
  }

  async function approveMatch(bankTransactionId: number, cardcomInvoiceNumber: string) {
    setApproving(bankTransactionId);
    setError(null);
    try {
      const note = noteDraft[bankTransactionId]?.trim() || null;
      const res = await fetch("/api/reconcile/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankTransactionId, cardcomInvoiceNumber, note }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה באישור");
      setNoteDraft((d) => {
        const n = { ...d };
        delete n[bankTransactionId];
        return n;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה באישור");
    } finally {
      setApproving(null);
    }
  }

  async function bulkApproveTopCandidates() {
    const SIM_THRESHOLD = 0.8;
    const allUnmatched = rows.filter((r) => !r.match && r.candidates.length > 0);
    // בטיחות: רק שורות שהמועמד המוביל שלהן עם דמיון שם גבוה (≥80%)
    const targets = allUnmatched.filter(
      (r) => r.candidates[0].nameSimilarity >= SIM_THRESHOLD
    );
    const skipped = allUnmatched.length - targets.length;
    if (targets.length === 0) {
      alert(
        skipped > 0
          ? `אין שורות לאישור אוטומטי בטוח.\n${skipped} שורות נפסלו כי דמיון השם של המועמד המוביל נמוך מ-80%. אשר אותן ידנית.`
          : "אין שורות לאישור."
      );
      return;
    }
    const msg =
      skipped > 0
        ? `לאשר את המועמד המוביל של ${targets.length} שורות (דמיון שם ≥80%)?\n\n${skipped} שורות עם דמיון נמוך נפסלו וידרשו אישור ידני.`
        : `לאשר את המועמד המוביל של ${targets.length} שורות "ללא חשבונית"?\n\nהשורות הללו יסומנו כ"ודאית" עם הערה "אישור מרובה — מועמד מוביל".`;
    if (!confirm(msg)) return;
    setBulkBusy(true);
    setError(null);
    try {
      const items = targets.map((r) => ({
        bankTransactionId: r.id,
        cardcomInvoiceNumber: r.candidates[0].invoiceNumber,
        note: "אישור מרובה — מועמד מוביל",
      }));
      const res = await fetch("/api/reconcile/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      setInfo(`אושרו ${j.approved} שורות. נותרו רק תנועות ללא מועמד כלל.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkApprove() {
    if (bulkSelected.size === 0) return;
    if (!confirm(`לאשר ${bulkSelected.size} שורות?`)) return;
    setBulkBusy(true);
    setError(null);
    try {
      const items = rows
        .filter((r) => bulkSelected.has(r.id) && r.match && !r.match.approved)
        .map((r) => ({
          bankTransactionId: r.id,
          cardcomInvoiceNumber: r.match!.invoiceNumber,
          note: noteDraft[r.id]?.trim() || null,
        }));
      const res = await fetch("/api/reconcile/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      setBulkSelected(new Set());
      setNoteDraft({});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה באישור");
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleBulk(id: number) {
    setBulkSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function approveNoInvoice(bankTransactionId: number) {
    const reason = (noInvDraft[bankTransactionId] ?? "").trim();
    if (!reason) {
      alert("חובה לרשום סיבה (החזר ממ״ה / ביטוח לאומי / לא מכירה...)");
      return;
    }
    setApproving(bankTransactionId);
    setError(null);
    try {
      const res = await fetch("/api/reconcile/no-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankTransactionId, reason }),
      });
      const j = await res.json();
      if (!res.ok) {
        if (res.status === 403) throw new Error("רק אדמין יכול לאשר ללא חשבונית");
        throw new Error(j.error || "שגיאה");
      }
      setNoInvDraft((d) => {
        const n = { ...d };
        delete n[bankTransactionId];
        return n;
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setApproving(null);
    }
  }

  async function unapproveNoInvoice(bankTransactionId: number) {
    if (!confirm("לבטל את אישור האדמין?")) return;
    setApproving(bankTransactionId);
    setError(null);
    try {
      const res = await fetch(
        `/api/reconcile/no-invoice?bankTransactionId=${bankTransactionId}`,
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

  async function unapproveMatch(bankTransactionId: number) {
    if (!confirm("לבטל את האישור?")) return;
    setApproving(bankTransactionId);
    setError(null);
    try {
      const res = await fetch(`/api/reconcile/approve?bankTransactionId=${bankTransactionId}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setApproving(null);
    }
  }

  const bulkableIds = useMemo(
    () => rows.filter((r) => r.match?.confidence === "medium" && !r.match.approved).map((r) => r.id),
    [rows]
  );

  const filteredRows = useMemo(() => {
    switch (filter) {
      case "high":
        return rows.filter((r) => r.match?.confidence === "high");
      case "medium":
        return rows.filter((r) => r.match?.confidence === "medium");
      case "noInvoice":
        return rows.filter((r) => !r.match && r.noInvoiceApproval);
      case "unmatched":
        return rows.filter((r) => !r.match && !r.noInvoiceApproval);
      default:
        return rows;
    }
  }, [rows, filter]);

  const visibleBulkable = useMemo(
    () => filteredRows.filter((r) => r.match?.confidence === "medium" && !r.match.approved),
    [filteredRows]
  );
  const unmatchedWithCandidates = useMemo(
    () =>
      rows.filter((r) => !r.match && !r.noInvoiceApproval && r.candidates.length > 0)
        .length,
    [rows]
  );
  const allVisibleSelected =
    visibleBulkable.length > 0 && visibleBulkable.every((r) => bulkSelected.has(r.id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setBulkSelected(new Set());
    } else {
      setBulkSelected(new Set(visibleBulkable.map((r) => r.id)));
    }
  }

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
          <div>
            <label className="block text-xs text-muted-foreground mb-1">חלון ± ימים</label>
            <input
              type="number"
              min={1}
              max={120}
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value) || 60)}
              className="input w-20"
              dir="ltr"
            />
          </div>
          <button onClick={load} className="btn-primary" disabled={loading || working}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            רענן
          </button>
          <button onClick={syncCardcom} className="btn-secondary" disabled={working}>
            <RefreshCcw className="w-4 h-4" />
            סנכרן Cardcom
          </button>
          <label className="btn-outline cursor-pointer">
            <Upload className="w-4 h-4" />
            העלה Excel בנק
            <input
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadBank(f);
                e.target.value = "";
              }}
              disabled={working}
            />
          </label>
          <label className="btn-outline cursor-pointer" title="ייבוא מקובץ 'מסמכים' של Cardcom">
            <FileSpreadsheet className="w-4 h-4" />
            ייבא Cardcom מאקסל
            <input
              type="file"
              accept=".xlsx,.xlsm,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportCardcomExcel(f);
                e.target.value = "";
              }}
              disabled={working}
            />
          </label>

          <div className="flex-1" />

          <a href="/fireberry-matches" className="btn-outline">
            שלב ב׳: בנק ↔ Fireberry →
          </a>
        </div>

        {(info || error) && (
          <div className="mt-3 space-y-1.5 text-sm">
            {info && (
              <div className="flex items-center gap-2 text-blue-700 bg-blue-50 px-3 py-2 rounded-md">
                <FileSpreadsheet className="w-4 h-4" /> {info}
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

      <div className="card p-3">
        <div className="text-sm font-semibold mb-1">שלב א׳ — בנק ↔ Cardcom</div>
        <div className="text-xs text-muted-foreground">
          לכל תנועת בנק נכנסת מאתרים את החשבונית ב-Cardcom שהופקה עבור הכסף הזה.
          ⚠ ללא חשבונית = קיבלת כסף בלי שהופקה חשבונית.
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <FilterCard
            label="סה״כ תנועות"
            value={String(summary.total)}
            sub={formatILS(summary.totalAmount)}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterCard
            label="התאמה ודאית"
            value={String(summary.high)}
            tone="green"
            active={filter === "high"}
            onClick={() => setFilter(filter === "high" ? "all" : "high")}
          />
          <FilterCard
            label="חלקית — דורש בדיקה"
            value={String(summary.medium)}
            tone="amber"
            active={filter === "medium"}
            onClick={() => setFilter(filter === "medium" ? "all" : "medium")}
          />
          <FilterCard
            label="אישור אדמין (ללא חשבונית)"
            value={String(summary.noInvoice)}
            tone="blue"
            active={filter === "noInvoice"}
            onClick={() => setFilter(filter === "noInvoice" ? "all" : "noInvoice")}
          />
          <FilterCard
            label="ללא חשבונית"
            value={String(summary.unmatched)}
            sub={`חוסר: ${formatILS(summary.unmatchedAmount)}`}
            tone="red"
            active={filter === "unmatched"}
            onClick={() => setFilter(filter === "unmatched" ? "all" : "unmatched")}
          />
        </div>
      )}

      {unmatchedWithCandidates > 0 && filter === "unmatched" && (
        <div className="card p-2 flex items-center gap-3 bg-red-50 border-red-200">
          <span className="text-sm">
            <b>{unmatchedWithCandidates}</b> שורות "ללא חשבונית" יש להן מועמד אפשרי
          </span>
          <button
            onClick={bulkApproveTopCandidates}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            title="אישור חד-פעמי של המועמד המוביל בכל אחת"
          >
            {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            אשר את כולן (מועמד מוביל)
          </button>
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            פעולה חד-פעמית. אחרי זה יישארו רק תנועות ללא מועמד כלל.
          </span>
        </div>
      )}

      {bulkableIds.length > 0 && (
        <div className="card p-2 flex items-center gap-3 bg-amber-50 border-amber-200">
          <span className="text-sm">
            נבחרו <b>{bulkSelected.size}</b> מתוך {bulkableIds.length} חלקיות
          </span>
          <button
            onClick={bulkApprove}
            disabled={bulkSelected.size === 0 || bulkBusy}
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            אשר נבחרים
          </button>
          {bulkSelected.size > 0 && (
            <button
              onClick={() => setBulkSelected(new Set())}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              נקה בחירה
            </button>
          )}
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            טיפ: סמנו checkbox בטבלה. הערה אופציונלית — הקלידו לפני האישור.
          </span>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-380px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 z-10">
              <tr className="text-right">
                <th className="px-2 py-2 w-8">
                  {visibleBulkable.length > 0 && (
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      title="בחר/בטל הכל"
                    />
                  )}
                </th>
                <th className="px-2 py-2 w-8"></th>
                <th className="px-2 py-2">סטטוס</th>
                <th className="px-2 py-2">תאריך בנק</th>
                <th className="px-2 py-2">סכום</th>
                <th className="px-2 py-2">שם בנק</th>
                <th className="px-2 py-2">אסמכתא</th>
                <th className="px-2 py-2 border-r-2 border-slate-300">→ חשבונית</th>
                <th className="px-2 py-2">לקוח Cardcom</th>
                <th className="px-2 py-2">פער ימים</th>
                <th className="px-2 py-2">סיבה</th>
                <th className="px-2 py-2">פעולה</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={12} className="text-center py-8 text-muted-foreground">
                    אין שורות להצגה
                  </td>
                </tr>
              )}
              {filteredRows.map((r) => {
                const isExpanded = expanded.has(r.id);
                const hasCandidates = !r.match && r.candidates.length > 0;
                return (
                  <Fragment key={r.id}>
                    <tr className={`border-t hover:bg-slate-50 ${bulkSelected.has(r.id) ? "bg-amber-50" : ""}`}>
                      <td className="px-2 py-1.5 align-top">
                        {r.match?.confidence === "medium" && !r.match.approved && (
                          <input
                            type="checkbox"
                            checked={bulkSelected.has(r.id)}
                            onChange={() => toggleBulk(r.id)}
                            title="סמן לאישור מרובה"
                          />
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        {hasCandidates && (
                          <button
                            onClick={() => toggleExpand(r.id)}
                            className="hover:bg-slate-200 rounded p-0.5"
                            title="הצג מועמדים"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronLeft className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap">
                        <ConfidenceBadge row={r} />
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap">
                        {formatDateIL(r.txDate)}
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap font-medium">
                        {formatILS(r.amount)}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <div>{r.extractedName ?? "—"}</div>
                        {r.extractedAccount && (
                          <div className="text-xs text-muted-foreground" dir="ltr">
                            {r.extractedAccount}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top text-xs" dir="ltr">
                        {r.reference ?? ""}
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap font-medium border-r-2 border-slate-300">
                        {r.match ? (
                          `#${r.match.invoiceNumber}`
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        {r.match?.customerName ?? "—"}
                        {r.match?.customerId && (
                          <div className="text-xs text-muted-foreground">ת.ז. {r.match.customerId}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap text-xs">
                        {r.match ? `${r.match.daysDiff} ימים` : "—"}
                      </td>
                      <td className="px-2 py-1.5 align-top text-xs text-muted-foreground">
                        {r.match?.reason ??
                          (r.noInvoiceApproval
                            ? `אושר אדמין — ${r.noInvoiceApproval.reason}`
                            : hasCandidates
                              ? "לא נמצאה התאמה ודאית"
                              : "אין מועמדים")}
                      </td>
                      <td className="px-2 py-1.5 align-top whitespace-nowrap">
                        {r.noInvoiceApproval ? (
                          <button
                            onClick={() => unapproveNoInvoice(r.id)}
                            disabled={approving === r.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-100 text-slate-700"
                            title="ביטול אישור אדמין"
                          >
                            {approving === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                            בטל אישור
                          </button>
                        ) : !r.match ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              placeholder="סיבה (חובה)"
                              value={noInvDraft[r.id] ?? ""}
                              onChange={(e) =>
                                setNoInvDraft((d) => ({ ...d, [r.id]: e.target.value }))
                              }
                              className="input text-xs px-2 py-1 w-36"
                            />
                            <button
                              onClick={() => approveNoInvoice(r.id)}
                              disabled={approving === r.id}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                              title="אישור אדמין: אין צורך בחשבונית"
                            >
                              {approving === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              אשר ללא חשבונית
                            </button>
                          </div>
                        ) : r.match?.approved ? (
                          <button
                            onClick={() => unapproveMatch(r.id)}
                            disabled={approving === r.id}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-slate-300 hover:bg-slate-100 text-slate-700"
                            title="ביטול אישור ידני"
                          >
                            {approving === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                            בטל אישור
                          </button>
                        ) : r.match?.confidence === "medium" ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              placeholder="הערה (אופציונלי)"
                              value={noteDraft[r.id] ?? ""}
                              onChange={(e) =>
                                setNoteDraft((d) => ({ ...d, [r.id]: e.target.value }))
                              }
                              className="input text-xs px-2 py-1 w-32"
                            />
                            <button
                              onClick={() => approveMatch(r.id, r.match!.invoiceNumber)}
                              disabled={approving === r.id}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                              title="אשר התאמה"
                            >
                              {approving === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              אשר
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                    {isExpanded && hasCandidates && (
                      <tr className="bg-slate-50 border-t">
                        <td colSpan={12} className="px-4 py-2">
                          <div className="text-xs text-muted-foreground mb-1">
                            מועמדים אפשריים ({r.candidates.length}):
                          </div>
                          <div className="space-y-1">
                            {r.candidates.map((c) => (
                              <div
                                key={c.invoiceNumber}
                                className="flex flex-wrap items-center gap-3 text-sm bg-white p-1.5 rounded"
                              >
                                <span className="font-medium">#{c.invoiceNumber}</span>
                                <span>{c.customerName ?? "—"}</span>
                                {c.customerId && (
                                  <span className="text-xs text-muted-foreground">ת.ז. {c.customerId}</span>
                                )}
                                <span className="text-xs">
                                  {c.totalIncludeVat != null ? formatILS(c.totalIncludeVat) : "—"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatDateIL(c.invoiceDate)}
                                </span>
                                <span className="text-xs text-blue-700">
                                  {(c.nameSimilarity * 100).toFixed(0)}%
                                </span>
                                <span className="text-xs text-muted-foreground">{c.reason}</span>
                                <div className="flex-1" />
                                <input
                                  type="text"
                                  placeholder="הערה"
                                  value={noteDraft[r.id] ?? ""}
                                  onChange={(e) =>
                                    setNoteDraft((d) => ({ ...d, [r.id]: e.target.value }))
                                  }
                                  className="input text-xs px-2 py-1 w-28"
                                />
                                <button
                                  onClick={() => approveMatch(r.id, c.invoiceNumber)}
                                  disabled={approving === r.id}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                                  title="אשר את החשבונית הזו"
                                >
                                  {approving === r.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Check className="w-3 h-3" />
                                  )}
                                  זאת החשבונית
                                </button>
                              </div>
                            ))}
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

function ConfidenceBadge({
  row,
}: {
  row: Row;
}) {
  if (row.match?.confidence === "high") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="w-3 h-3" /> ודאית
      </span>
    );
  }
  if (row.match?.confidence === "medium") {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
        <AlertTriangle className="w-3 h-3" /> חלקית
      </span>
    );
  }
  if (row.noInvoiceApproval) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"
        title={row.noInvoiceApproval.reason}
      >
        <CheckCircle2 className="w-3 h-3" /> אושר אדמין
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
      <HelpCircle className="w-3 h-3" /> ללא
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
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red" | "blue";
  active?: boolean;
  onClick?: () => void;
}) {
  const tones = {
    green: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
    blue: "border-blue-200 bg-blue-50",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card p-3 text-right transition cursor-pointer hover:brightness-95 ${
        tone ? tones[tone] : ""
      } ${active ? "ring-2 ring-blue-500" : ""}`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </button>
  );
}
