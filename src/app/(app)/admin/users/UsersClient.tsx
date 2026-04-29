"use client";

import { useEffect, useState } from "react";
import { Plus, Power, KeyRound, Loader2 } from "lucide-react";
import { formatDateIL } from "@/lib/utils";

type U = {
  id: number;
  email: string;
  fullName: string | null;
  role: "admin" | "user";
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

export default function UsersClient() {
  const [list, setList] = useState<U[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/users");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setList(j.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, fullName, role }),
    });
    const j = await r.json();
    if (!r.ok) {
      setError(j.error);
      return;
    }
    setShowAdd(false);
    setEmail("");
    setPassword("");
    setFullName("");
    setRole("user");
    await load();
  }

  async function toggleActive(u: U) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, isActive: !u.isActive }),
    });
    load();
  }

  async function resetPwd(u: U) {
    const pwd = prompt(`סיסמה חדשה ל-${u.email}:`);
    if (!pwd || pwd.length < 6) return;
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, password: pwd }),
    });
    alert("הסיסמה עודכנה");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">ניהול משתמשים</h2>
        <button onClick={() => setShowAdd(!showAdd)} className="btn-primary">
          <Plus className="w-4 h-4" /> הוסף משתמש
        </button>
      </div>

      {showAdd && (
        <form onSubmit={add} className="card p-4 grid sm:grid-cols-2 gap-3">
          <input
            placeholder="אימייל"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            dir="ltr"
          />
          <input
            placeholder="סיסמה (6+ תווים)"
            type="text"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            dir="ltr"
          />
          <input
            placeholder="שם מלא (לא חובה)"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "user")}
            className="input"
          >
            <option value="user">משתמש רגיל</option>
            <option value="admin">מנהל</option>
          </select>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" className="btn-primary">
              צור
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="btn-outline">
              ביטול
            </button>
          </div>
        </form>
      )}

      {error && <div className="text-destructive bg-destructive/10 p-2 rounded">{error}</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-3 py-2 text-right">אימייל</th>
              <th className="px-3 py-2 text-right">שם</th>
              <th className="px-3 py-2 text-right">תפקיד</th>
              <th className="px-3 py-2 text-right">פעיל</th>
              <th className="px-3 py-2 text-right">נוצר</th>
              <th className="px-3 py-2 text-right">כניסה אחרונה</th>
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
            {list.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2" dir="ltr">{u.email}</td>
                <td className="px-3 py-2">{u.fullName ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === "admin" ? "bg-violet-100 text-violet-700" : "bg-slate-100"}`}>
                    {u.role === "admin" ? "מנהל" : "משתמש"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {u.isActive ? "✓" : "✗"}
                </td>
                <td className="px-3 py-2 text-xs">{formatDateIL(u.createdAt)}</td>
                <td className="px-3 py-2 text-xs">{u.lastLoginAt ? formatDateIL(u.lastLoginAt) : "—"}</td>
                <td className="px-3 py-2 flex gap-1 justify-end">
                  <button onClick={() => toggleActive(u)} className="btn-ghost px-2 py-1 text-xs" title="הפעל/השבת">
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => resetPwd(u)} className="btn-ghost px-2 py-1 text-xs" title="אפס סיסמה">
                    <KeyRound className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
