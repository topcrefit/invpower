"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Home, Users, Bell, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Navbar({
  user,
}: {
  user: { email: string; role: "admin" | "user" };
}) {
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const links = [
    { href: "/dashboard", label: "דאשבורד", icon: Home, show: true },
    { href: "/admin/users", label: "משתמשים", icon: Users, show: user.role === "admin" },
    { href: "/admin/alerts", label: "התראות", icon: Bell, show: user.role === "admin" },
    {
      href: "/admin/settings",
      label: "הגדרות",
      icon: Settings,
      show: user.role === "admin",
    },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b">
      <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="font-bold text-lg">InvPower</Link>
          <nav className="flex items-center gap-1">
            {links
              .filter((l) => l.show)
              .map((l) => {
                const active = path?.startsWith(l.href);
                const Icon = l.icon;
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                      active ? "bg-primary/10 text-primary" : "hover:bg-accent"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {l.label}
                  </Link>
                );
              })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:inline">
            {user.email}
          </span>
          <button onClick={logout} className="btn-ghost text-sm" title="התנתק">
            <LogOut className="w-4 h-4" /> התנתק
          </button>
        </div>
      </div>
    </header>
  );
}
