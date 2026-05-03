"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, FileSpreadsheet, AlertTriangle } from "lucide-react";

type Period = "month" | "quarter" | "year" | "custom";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function startOfMonth(year: number, month0: number) {
  return new Date(year, month0, 1);
}
function endOfMonth(year: number, month0: number) {
  return new Date(year, month0 + 1, 0);
}
function startOfQuarter(year: number, q: number) {
  return new Date(year, (q - 1) * 3, 1);
}
function endOfQuarter(year: number, q: number) {
  return new Date(year, q * 3, 0);
}

const HEBREW_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

export default function IncomeReportClient() {
  const now = new Date();
  const [period, setPeriod] = useState<Period>("month");
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month0, setMonth0] = useState<number>(now.getMonth());
  const [quarter, setQuarter] = useState<number>(
    Math.floor(now.getMonth() / 3) + 1
  );
  // for custom period, allow user override; for preset periods, calc auto
  const [customFrom, setCustomFrom] = useState<string>(
    ymd(startOfMonth(now.getFullYear(), now.getMonth()))
  );
  const [customTo, setCustomTo] = useState<string>(
    ymd(endOfMonth(now.getFullYear(), now.getMonth()))
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { from, to } = useMemo(() => {
    if (period === "month") {
      return {
        from: ymd(startOfMonth(year, month0)),
        to: ymd(endOfMonth(year, month0)),
      };
    }
    if (period === "quarter") {
      return {
        from: ymd(startOfQuarter(year, quarter)),
        to: ymd(endOfQuarter(year, quarter)),
      };
    }
    if (period === "year") {
      return {
        from: ymd(new Date(year, 0, 1)),
        to: ymd(new Date(year, 11, 31)),
      };
    }
    return { from: customFrom, to: customTo };
  }, [period, year, month0, quarter, customFrom, customTo]);

  // For custom inputs we keep them in sync if user switches to a preset
  function syncCustomFromPreset() {
    setCustomFrom(from);
    setCustomTo(to);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const url = `/api/reports/income?from=${encodeURIComponent(
        from
      )}&to=${encodeURIComponent(to)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = `income_${from}_${to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Years for selector — last 5 + current + next 1
  const years: number[] = [];
  for (let y = now.getFullYear() - 5; y <= now.getFullYear() + 1; y++) {
    years.push(y);
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-4">
        <FileSpreadsheet className="w-6 h-6 text-emerald-700" />
        <h1 className="text-2xl font-bold">דוח הכנסות</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        מושך את כל החשבוניות שהופקו בטווח התאריכים ישירות מ-Cardcom, ומוריד אקסל
        מסודר עם סיכום בתחתית.
      </p>

      <div className="bg-white rounded-lg border p-5 space-y-5">
        {/* Period type */}
        <div>
          <label className="text-sm font-semibold block mb-2">תקופה</label>
          <div className="flex gap-2 flex-wrap">
            {(["month", "quarter", "year", "custom"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPeriod(p);
                  if (p === "custom") syncCustomFromPreset();
                }}
                className={
                  period === p
                    ? "px-4 py-1.5 rounded-md text-sm bg-emerald-600 text-white"
                    : "px-4 py-1.5 rounded-md text-sm bg-slate-100 hover:bg-slate-200"
                }
              >
                {p === "month"
                  ? "חודש"
                  : p === "quarter"
                    ? "רבעון"
                    : p === "year"
                      ? "שנה"
                      : "טווח חופשי"}
              </button>
            ))}
          </div>
        </div>

        {/* Period selectors */}
        {period === "month" && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">
                חודש
              </label>
              <select
                value={month0}
                onChange={(e) => setMonth0(Number(e.target.value))}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                {HEBREW_MONTHS.map((m, i) => (
                  <option key={i} value={i}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">
                שנה
              </label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {period === "quarter" && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">
                רבעון
              </label>
              <select
                value={quarter}
                onChange={(e) => setQuarter(Number(e.target.value))}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                <option value={1}>Q1 (ינואר–מרץ)</option>
                <option value={2}>Q2 (אפריל–יוני)</option>
                <option value={3}>Q3 (יולי–ספטמבר)</option>
                <option value={4}>Q4 (אוקטובר–דצמבר)</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">
                שנה
              </label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full border rounded-md px-3 py-2 text-sm"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {period === "year" && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              שנה
            </label>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="border rounded-md px-3 py-2 text-sm w-40"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        {period === "custom" && (
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">
                מתאריך
              </label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">
                עד תאריך
              </label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full border rounded-md px-3 py-2 text-sm"
              />
            </div>
          </div>
        )}

        {/* Summary preview */}
        <div className="bg-slate-50 rounded-md px-4 py-3 text-sm">
          <span className="text-muted-foreground">טווח:</span>{" "}
          <span className="font-medium">{from}</span>{" "}
          <span className="text-muted-foreground">עד</span>{" "}
          <span className="font-medium">{to}</span>
        </div>

        {/* Generate button */}
        <button
          onClick={generate}
          disabled={busy}
          className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white py-2.5 rounded-md font-medium flex items-center justify-center gap-2"
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              שולף מ-Cardcom ובונה אקסל...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              הפק והורד אקסל
            </>
          )}
        </button>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
