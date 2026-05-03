import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Navbar from "@/components/Navbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.userId) redirect("/login");

  const rows = await db.select().from(users).where(eq(users.id, session.userId));
  const me = rows[0];
  if (!me || !me.isActive) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar user={{ email: me.email, role: me.role }} />
      <main className="container mx-auto px-4 py-3">{children}</main>
    </div>
  );
}
