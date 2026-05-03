"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRef } from "react";
import {
  RefreshCcw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  FileText,
  Download,
  Upload,
} from "lucide-react";
import { formatDateIL, formatILS } from "@/lib/utils";

type Row = {
  bankTransactionId: number;
  txDate: string;
  valueDate: string | null;
  description: string | null;
  reference: string | null;
  amount: number;
  extendedDescription: string | null;
  extractedName: string | null;
  extractedAccount: string | null;
  note: string | null;
  status: "ready_to_issue" | "already_issued" | "admin_approved" | "no_match";
  adminApproval: { reason: string; approvedAt: string | null } | null;
  fireberry: {
    purchaseId: number;
    accountProductId: string;
    accountId: string | null;
    customerName: string | null;
    customerTaxId: string | null;
    customerPhone: string | null;
    productDescription: string | null;
    price: number | null;
    createdOn: string | null;
    nameSimilarity: number;
    daysDiff: number;
  } | null;
  issuedInvoice: {
    invoiceNumber: string | null;
    invoiceLink: string | null;
    issuedAt: string | null;
  } | null;
};

type Summary = {
  total: number;
  readyToIssue: number;
  alreadyIssued: number;
  adminApproved: number;
  noMatch: number;
  readyAmount: number;
  issuedAmount: number;
  adminApprovedAmount: number;
  noMatchAmount: number;
};

type Tab = "ready" | "no_match" | "issued" | "admin";

type SortKey =
  | "txDate"
  | "reference"
  | "extractedName"
  | "amount"
  | "fireberryName"
  | "invoiceNumber";
type SortDir = "asc" | "desc";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthsAgoISO(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export default function BankAuditClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [from, setFrom] = useState(monthsAgoISO(2));
  const [to, setTo] = useState(todayISO());
  const [tab, setTab] = useState<Tab>("ready");
  const [sortKey, setSortKey] = useState<SortKey>("txDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkIssuing, setBulkIssuing] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [approvalReason, setApprovalReason] = useState<Record<number, string>>(
    {}
  );
  const [approving, setApproving] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/audit/bank-status?${params.toString()}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      setRows(j.rows);
      setSummary(j.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const filtered = useMemo(() => {
    let list = rows;
    if (tab === "ready") list = list.filter((r) => r.status === "ready_to_issue");
    else if (tab === "no_match") list = list.filter((r) => r.status === "no_match");
    else if (tab === "issued") list = list.filter((r) => r.status === "already_issued");
    else if (tab === "admin") list = list.filter((r) => r.status === "admin_approved");

    const sign = sortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "txDate":
          av = a.txDate;
          bv = b.txDate;
          break;
        case "reference":
          av = a.reference ?? "";
          bv = b.reference ?? "";
          break;
        case "extractedName":
          av = a.extractedName ?? "";
          bv = b.extractedName ?? "";
          break;
        case "amount":
          av = a.amount;
          bv = b.amount;
          break;
        case "fireberryName":
          av = a.fireberry?.customerName ?? "";
          bv = b.fireberry?.customerName ?? "";
          break;
        case "invoiceNumber":
          av = a.issuedInvoice?.invoiceNumber ?? "";
          bv = b.issuedInvoice?.invoiceNumber ?? "";
          break;
      }
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * sign;
      return String(av).localeCompare(String(bv), "he") * sign;
    });
    return list;
  }, [rows, tab, sortKey, sortDir]);

  async function approveAdmin(row: Row) {
    const reason = (approvalReason[row.bankTransactionId] ?? "").trim();
    if (!reason) {
      setError("יש להזין סיבה לאישור");
      return;
    }
    setApproving(row.bankTransactionId);
    setError(null);
    try {
      const res = await fetch("/api/reconcile/no-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankTransactionId: row.bankTransactionId,
          reason,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      setApprovalReason((prev) => {
        const next = { ...prev };
        delete next[row.bankTransactionId];
        return next;
      });
      setInfo(`התנועה אושרה ע"י אדמין: ${row.extractedName ?? "?"} - ${reason}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setApproving(null);
    }
  }

  async function onUploadBank(file: File) {
    setUploading(true);
    setError(null);
    setInfo(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/bank/upload", {
        method: "POST",
        body: fd,
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאת העלאה");
      if (j.duplicate) {
        setInfo("הקובץ הזה כבר הועלה בעבר");
      } else {
        setInfo(
          `הועלו ${j.inserted} שורות (${j.skipped} כפילויות). טווח: ${j.dateFrom?.slice(0, 10)} – ${j.dateTo?.slice(0, 10)}`
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאת העלאה");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function syncAll() {
    setSyncingAll(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/sync-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      const cc = j.cardcom?.ok
        ? `Cardcom ✓ (${j.cardcom.total ?? 0})`
        : `Cardcom ✗ ${j.cardcom?.error ?? ""}`;
      const fb = j.fireberry?.ok
        ? `Fireberry ✓ (${j.fireberry.total ?? 0})`
        : `Fireberry ✗ ${j.fireberry?.error ?? ""}`;
      setInfo(`סנכרון הושלם: ${cc} | ${fb}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בסנכרון");
    } finally {
      setSyncingAll(false);
    }
  }

  function exportToCsv() {
    const headers = [
      "תאריך בנק",
      "אסמכתא",
      "שם בבנק",
      "חשבון בנק",
      "סכום",
      "תיאור",
      "סטטוס",
      "לקוח Fireberry",
      "ת.ז.",
      "טלפון",
      "תיאור מוצר",
      "מספר חשבונית",
      "קישור PDF",
    ];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const statusText =
        r.status === "ready_to_issue"
          ? "מוכן להפקה"
          : r.status === "already_issued"
            ? "הופקה"
            : "אין חשבונית";
      const cells = [
        r.txDate.slice(0, 10),
        r.reference ?? "",
        (r.extractedName ?? "").replace(/"/g, ""),
        r.extractedAccount ?? "",
        r.amount.toFixed(2),
        (r.description ?? "").replace(/"/g, ""),
        statusText,
        (r.fireberry?.customerName ?? "").replace(/"/g, ""),
        r.fireberry?.customerTaxId ?? "",
        r.fireberry?.customerPhone ?? "",
        (r.fireberry?.productDescription ?? "").replace(/"/g, ""),
        r.issuedInvoice?.invoiceNumber ?? "",
        r.issuedInvoice?.invoiceLink ?? "",
      ];
      lines.push(cells.map((c) => `"${c}"`).join(","));
    }
    // BOM ל-UTF-8 כדי שאקסל יציג עברית נכון
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const tabLabel =
      tab === "ready"
        ? "מוכן-להפקה"
        : tab === "no_match"
          ? "ללא-חשבונית"
          : "הופקה";
    a.download = `bank-audit-${tabLabel}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const issuable = filtered.filter(
      (r) => r.status === "ready_to_issue" && !issueResults[r.bankTransactionId]
    );
    if (issuable.every((r) => selected.has(r.bankTransactionId))) {
      // הכל מסומן — לבטל הכל
      setSelected(new Set());
    } else {
      // לסמן הכל
      setSelected(new Set(issuable.map((r) => r.bankTransactionId)));
    }
  }

  async function issueBulk() {
    const pairs: Array<{
      bankTransactionId: number;
      fireberryPurchaseId: number;
    }> = [];
    for (const r of filtered) {
      if (!selected.has(r.bankTransactionId)) continue;
      if (!r.fireberry) continue;
      pairs.push({
        bankTransactionId: r.bankTransactionId,
        fireberryPurchaseId: r.fireberry.purchaseId,
      });
    }
    if (pairs.length === 0) return;
    if (
      !confirm(
        `⚠️ עומדים להפיק ${pairs.length} חשבוניות אמיתיות ב-Cardcom.\n\nפעולה זו בלתי הפיכה.\n\nלהמשיך?`
      )
    )
      return;
    setBulkIssuing(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
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
        updates[r.bankTransactionId] = {
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
      setSelected(new Set());
      setInfo(`הופקו: ${issued} | דולגו: ${skipped} | נכשלו: ${failed}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setBulkIssuing(false);
    }
  }

  async function issueOne(row: Row) {
    if (!row.fireberry) return;
    setIssuing((prev) => new Set(prev).add(row.bankTransactionId));
    setError(null);
    try {
      const res = await fetch("/api/invoices/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairs: [
            {
              bankTransactionId: row.bankTransactionId,
              fireberryPurchaseId: row.fireberry.purchaseId,
            },
          ],
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "שגיאה");
      const r = j.results?.[0];
      if (r) {
        setIssueResults((prev) => ({
          ...prev,
          [row.bankTransactionId]: {
            status: r.status,
            message: r.message,
            invoiceNumber: r.invoiceNumber,
            invoiceLink: r.invoiceLink,
          },
        }));
        setInfo(r.message);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setIssuing((prev) => {
        const next = new Set(prev);
        next.delete(row.bankTransactionId);
        return next;
      });
    }
  }

  return (
    <div className="space-y-2" dir="rtl">
      <div className="card p-3 flex flex-wrap items-end gap-3">
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
        <button
          onClick={syncAll}
          className="btn-primary"
          disabled={loading || syncingAll || uploading}
          title="סנכרון מלא — Cardcom + Fireberry"
        >
          {syncingAll ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCcw className="w-4 h-4" />
          )}
          סנכרן הכל (Cardcom + Fireberry)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xls,.xlsx,.xlsm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadBank(f);
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="btn-secondary"
          disabled={uploading || syncingAll}
          title="העלה קובץ Excel של תנועות בנק"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          העלה קובץ בנק
        </button>
        <button
          onClick={load}
          className="btn-secondary"
          disabled={loading || syncingAll}
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCcw className="w-4 h-4" />
          )}
          רענן תצוגה
        </button>
        <button
          onClick={exportToCsv}
          className="btn-secondary"
          disabled={loading || filtered.length === 0}
          title="ייצא את התצוגה הנוכחית לקובץ CSV"
        >
          <Download className="w-4 h-4" />
          ייצא לאקסל
        </button>
        <div className="flex-1" />
      </div>

      <div className="px-1 text-xs text-muted-foreground flex items-center gap-2">
        <span className="font-semibold text-slate-700">📋 ביקורת תנועות בנק</span>
        <span>—</span>
        <span>לכל תנועה — האם יש Fireberry "לא נשלח" להפקה? לחץ על כותרת למיון</span>
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <FilterCard
            label="סה״כ תנועות"
            value={summary.total}
            sub={formatILS(
              summary.readyAmount +
                summary.issuedAmount +
                summary.adminApprovedAmount +
                summary.noMatchAmount
            )}
            active={false}
            onClick={() => {}}
          />
          <FilterCard
            label="🟢 מוכן להפקה"
            value={summary.readyToIssue}
            sub={formatILS(summary.readyAmount)}
            tone="green"
            active={tab === "ready"}
            onClick={() => setTab("ready")}
          />
          <FilterCard
            label="🔴 ללא חשבונית"
            value={summary.noMatch}
            sub={formatILS(summary.noMatchAmount)}
            tone="red"
            active={tab === "no_match"}
            onClick={() => setTab("no_match")}
          />
          <FilterCard
            label="✓ הופקה"
            value={summary.alreadyIssued}
            sub={formatILS(summary.issuedAmount)}
            tone="blue"
            active={tab === "issued"}
            onClick={() => setTab("issued")}
          />
          <FilterCard
            label="🟠 אושר אדמין"
            value={summary.adminApproved}
            sub={formatILS(summary.adminApprovedAmount)}
            tone="amber"
            active={tab === "admin"}
            onClick={() => setTab("admin")}
          />
        </div>
      )}

      {tab === "ready" && (() => {
        const issuableNow = filtered.filter(
          (r) => r.status === "ready_to_issue" && !issueResults[r.bankTransactionId]
        );
        if (issuableNow.length === 0) return null;
        const allSelected =
          issuableNow.length > 0 &&
          issuableNow.every((r) => selected.has(r.bankTransactionId));
        return (
          <div className="card p-3 bg-emerald-50 border-emerald-200 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                disabled={bulkIssuing}
              />
              בחר הכל ({issuableNow.length} מוכנות להפקה)
            </label>
            <button
              onClick={issueBulk}
              disabled={bulkIssuing || selected.size === 0}
              className="btn-primary text-sm"
            >
              {bulkIssuing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              הפק חשבוניות מסומנות ({selected.size})
            </button>
          </div>
        );
      })()}

      <div className="card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-360px)]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 z-10">
              {/* Group headers — Bank Leumi vs Fireberry */}
              <tr className="text-center text-xs font-bold uppercase tracking-wide bg-slate-200">
                {tab === "ready" && <th className="px-2 py-1.5"></th>}
                <th
                  className="px-2 py-1.5 text-blue-900 border-l-2 border-slate-400"
                  colSpan={5}
                >
                  בנק לאומי
                </th>
                {tab === "ready" && (
                  <th className="px-2 py-1.5 text-emerald-900" colSpan={3}>
                    FIREBERRY
                  </th>
                )}
                {tab === "issued" && (
                  <th className="px-2 py-1.5 text-emerald-900" colSpan={2}>
                    חשבונית
                  </th>
                )}
                {tab === "no_match" && (
                  <th className="px-2 py-1.5 text-amber-900">פעולה</th>
                )}
                {tab === "admin" && (
                  <th className="px-2 py-1.5 text-slate-700">סיבה</th>
                )}
              </tr>
              <tr className="text-right">
                {tab === "ready" && <th className="px-2 py-2 w-8"></th>}
                <Th
                  label="תאריך בנק"
                  k="txDate"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                />
                <Th
                  label="אסמכתא"
                  k="reference"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                />
                <Th
                  label="שם בבנק"
                  k="extractedName"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                />
                <th className="px-2 py-2">חשבון בנק</th>
                <Th
                  label="סכום"
                  k="amount"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onClick={toggleSort}
                  extraClass="border-l-2 border-slate-300"
                />
                {tab === "ready" && (
                  <>
                    <Th
                      label="לקוח Fireberry"
                      k="fireberryName"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                    />
                    <th className="px-2 py-2">ת.ז.</th>
                    <th className="px-2 py-2">פעולה</th>
                  </>
                )}
                {tab === "issued" && (
                  <>
                    <Th
                      label="חשבונית"
                      k="invoiceNumber"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onClick={toggleSort}
                    />
                    <th className="px-2 py-2">PDF</th>
                  </>
                )}
                {tab === "no_match" && (
                  <th className="px-2 py-2 min-w-[300px]">פעולה (סיבה + אישור)</th>
                )}
                {tab === "admin" && (
                  <th className="px-2 py-2">סיבת האישור</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-muted-foreground">
                    אין שורות להצגה
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const isIssuing = issuing.has(r.bankTransactionId);
                const issueRes = issueResults[r.bankTransactionId];
                const canSelect =
                  tab === "ready" &&
                  r.status === "ready_to_issue" &&
                  !issueRes;
                const isSelected = selected.has(r.bankTransactionId);
                return (
                  <tr
                    key={r.bankTransactionId}
                    className={
                      isSelected
                        ? "border-t bg-emerald-100 hover:bg-emerald-200"
                        : "border-t hover:bg-slate-50"
                    }
                  >
                    {tab === "ready" && (
                      <td className="px-2 py-1.5">
                        {canSelect && (
                          <input
                            type="checkbox"
                            checked={selected.has(r.bankTransactionId)}
                            onChange={() => toggleSelect(r.bankTransactionId)}
                            disabled={bulkIssuing}
                          />
                        )}
                      </td>
                    )}
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
                    <td className="px-2 py-1.5 whitespace-nowrap font-medium border-l-2 border-slate-200">
                      {formatILS(r.amount)}
                    </td>
                    {tab === "ready" && (
                      <>
                        <td className="px-2 py-1.5">
                          {r.fireberry?.customerName ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                          {r.fireberry?.customerTaxId ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          {issueRes ? (
                            <span
                              className={
                                issueRes.status === "issued"
                                  ? "text-emerald-700 text-xs"
                                  : "text-red-600 text-xs"
                              }
                              title={issueRes.message}
                            >
                              {issueRes.status === "issued"
                                ? `✓ #${issueRes.invoiceNumber}`
                                : `✗ ${issueRes.status}`}
                            </span>
                          ) : (
                            <button
                              onClick={() => issueOne(r)}
                              disabled={isIssuing}
                              className="text-xs text-blue-700 hover:text-blue-900 inline-flex items-center gap-1"
                            >
                              {isIssuing ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <FileText className="w-3 h-3" />
                              )}
                              הפק
                            </button>
                          )}
                        </td>
                      </>
                    )}
                    {tab === "issued" && (
                      <>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">
                          {r.issuedInvoice?.invoiceNumber ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-xs">
                          {r.issuedInvoice?.invoiceLink ? (
                            <a
                              href={r.issuedInvoice.invoiceLink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              פתח PDF
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                      </>
                    )}
                    {tab === "no_match" && (
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="סיבה (משכורת / טרנזילה / החזר וכו')"
                            value={approvalReason[r.bankTransactionId] ?? ""}
                            onChange={(e) =>
                              setApprovalReason((prev) => ({
                                ...prev,
                                [r.bankTransactionId]: e.target.value,
                              }))
                            }
                            className="input text-xs flex-1 min-w-[180px]"
                            disabled={approving === r.bankTransactionId}
                          />
                          <button
                            onClick={() => approveAdmin(r)}
                            disabled={
                              approving === r.bankTransactionId ||
                              !(approvalReason[r.bankTransactionId] ?? "").trim()
                            }
                            className="text-xs text-amber-700 hover:text-amber-900 inline-flex items-center gap-1 disabled:opacity-40"
                            title="אשר אדמין"
                          >
                            {approving === r.bankTransactionId ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3" />
                            )}
                            אשר אדמין
                          </button>
                        </div>
                      </td>
                    )}
                    {tab === "admin" && (
                      <td className="px-2 py-1.5 text-xs text-amber-800">
                        {r.adminApproval?.reason ?? "—"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Th({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
  extraClass,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  extraClass?: string;
}) {
  const active = sortKey === k;
  return (
    <th
      className={`px-2 py-2 cursor-pointer hover:bg-slate-200 select-none whitespace-nowrap ${extraClass ?? ""}`}
      onClick={() => onClick(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </span>
    </th>
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
  tone?: "green" | "red" | "blue" | "amber";
  active: boolean;
  onClick: () => void;
}) {
  const tones = {
    green: "border-emerald-200 bg-emerald-50",
    red: "border-red-200 bg-red-50",
    blue: "border-blue-200 bg-blue-50",
    amber: "border-amber-200 bg-amber-50",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`card px-2 py-1.5 text-right transition cursor-pointer hover:brightness-95 leading-tight ${
        tone ? tones[tone] : ""
      } ${active ? "ring-2 ring-blue-500" : ""}`}
    >
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </button>
  );
}
