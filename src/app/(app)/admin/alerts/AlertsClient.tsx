"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { formatDateIL } from "@/lib/utils";

type IssuedRef = {
  id: number;
  cardcomDocumentNumber: string | null;
  customerName: string;
  amount: number;
  fireberryStatus: string;
} | null;

type AlertItem = {
  id: number;
  severity: "info" | "warning" | "error";
  category: string;
  title: string;
  message: string;
  createdAt: string;
  acknowledgedAt: string | null;
  contextJson: string | null;
  invoice: IssuedRef;
};

export default function AlertsClient() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const r = await fetch(`/api/admin/alerts?open=${showAll ? "0" : "1"}`);
    const j = await r.json();
    setAlerts(j.alerts);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [showAll]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ack(id: number) {
    setBusyId(id);
    await fetch("/api/admin/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusyId(null);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">התראות</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          הצג גם התראות שנסגרו
        </label>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-right">חומרה</th>
              <th className="px-3 py-2 text-right">קטגוריה</th>
              <th className="px-3 py-2 text-right">כותרת</th>
              <th className="px-3 py-2 text-right">הודעה</th>
              <th className="px-3 py-2 text-right">חשבונית</th>
              <th className="px-3 py-2 text-right">נוצר</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="text-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin inline" />
                </td>
              </tr>
            )}
            {!loading && alerts.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-muted-foreground">
                  אין התראות פתוחות 🎉
                </td>
              </tr>
            )}
            {alerts.map((a) => (
              <tr key={a.id} className="border-t align-top">
                <td className="px-3 py-2"><Severity s={a.severity} /></td>
                <td className="px-3 py-2 text-xs">{a.category}</td>
                <td className="px-3 py-2 font-medium">{a.title}</td>
                <td className="px-3 py-2 max-w-md text-xs">{a.message}</td>
                <td className="px-3 py-2 text-xs">
                  {a.invoice ? (
                    <div>
                      <div>#{a.invoice.cardcomDocumentNumber ?? "—"}</div>
                      <div className="text-muted-foreground">{a.invoice.customerName}</div>
                      <div className="text-muted-foreground">{a.invoice.amount} ₪</div>
                    </div>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {formatDateIL(a.createdAt)}
                </td>
                <td className="px-3 py-2">
                  {a.acknowledgedAt ? (
                    <span className="text-xs text-muted-foreground">נסגר</span>
                  ) : (
                    <button
                      onClick={() => ack(a.id)}
                      className="btn-outline text-xs px-2 py-1"
                      disabled={busyId === a.id}
                    >
                      {busyId === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      סמן כטופל
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Severity({ s }: { s: "info" | "warning" | "error" }) {
  if (s === "error")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
        <AlertCircle className="w-3 h-3" /> שגיאה
      </span>
    );
  if (s === "warning")
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
        <AlertTriangle className="w-3 h-3" /> אזהרה
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
      <Info className="w-3 h-3" /> מידע
    </span>
  );
}
