"use client";

import { useEffect, useState } from "react";
import { Save, KeyRound, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type SettingStatus = { key: string; isSet: boolean; isSecret: boolean };

const KEY_LABELS: Record<string, string> = {
  "cardcom.terminal_number": "Cardcom: Terminal Number",
  "cardcom.api_name": "Cardcom: API Name",
  "cardcom.api_password": "Cardcom: API Password",
  "cardcom.base_url": "Cardcom: Base URL",
  "fireberry.token": "Fireberry: Token",
  "fireberry.base_url": "Fireberry: Base URL",
};

export default function SettingsClient() {
  const [status, setStatus] = useState<SettingStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [form, setForm] = useState({
    cardcomTerminalNumber: "",
    cardcomApiName: "",
    cardcomApiPassword: "",
    cardcomBaseUrl: "",
    fireberryToken: "",
    fireberryBaseUrl: "",
  });

  async function load() {
    setLoading(true);
    const r = await fetch("/api/admin/settings");
    const j = await r.json();
    setStatus(j.settings);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const onlyFilled: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) {
      if (v.trim()) onlyFilled[k] = v.trim();
    }
    if (Object.keys(onlyFilled).length === 0) {
      setMsg("לא הוזנו ערכים חדשים");
      setSaving(false);
      return;
    }
    const r = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(onlyFilled),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg(`שגיאה: ${j.error}`);
    } else {
      setMsg("נשמר בהצלחה");
      setForm({
        cardcomTerminalNumber: "",
        cardcomApiName: "",
        cardcomApiPassword: "",
        cardcomBaseUrl: "",
        fireberryToken: "",
        fireberryBaseUrl: "",
      });
      load();
    }
    setSaving(false);
  }

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <KeyRound className="w-5 h-5" /> הגדרות API
        </h2>
      </div>

      <div className="card p-4">
        <h3 className="font-medium mb-2">סטטוס הגדרות</h3>
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <ul className="space-y-1 text-sm">
            {status.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                {s.isSet ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
                <span className="font-mono text-xs">{s.key}</span>
                <span className="text-muted-foreground">— {KEY_LABELS[s.key] ?? s.key}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={save} className="card p-4 space-y-4">
        <div className="text-sm text-muted-foreground">
          השאר ריק כדי לא לעדכן. ערכים מוצפנים נשמרים מוצפנים ב-Turso ולא ניתן להציגם בחזרה.
        </div>

        <fieldset className="grid sm:grid-cols-2 gap-3">
          <legend className="font-medium mb-2">Cardcom</legend>
          <Field label="Terminal Number" value={form.cardcomTerminalNumber} onChange={update("cardcomTerminalNumber")} />
          <Field label="API Name" value={form.cardcomApiName} onChange={update("cardcomApiName")} />
          <Field label="API Password" value={form.cardcomApiPassword} onChange={update("cardcomApiPassword")} type="password" />
          <Field label="Base URL (optional)" value={form.cardcomBaseUrl} onChange={update("cardcomBaseUrl")} placeholder="https://secure.cardcom.solutions" />
        </fieldset>

        <fieldset className="grid sm:grid-cols-2 gap-3">
          <legend className="font-medium mb-2">Fireberry</legend>
          <Field label="Token" value={form.fireberryToken} onChange={update("fireberryToken")} type="password" />
          <Field label="Base URL (optional)" value={form.fireberryBaseUrl} onChange={update("fireberryBaseUrl")} placeholder="https://api.fireberry.com" />
        </fieldset>

        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            שמור
          </button>
          {msg && <span className="text-sm">{msg}</span>}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="input"
        dir="ltr"
        autoComplete="off"
      />
    </label>
  );
}
