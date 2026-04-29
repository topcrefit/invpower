import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { alerts, issuedInvoices } from "@/lib/db/schema";
import { desc, eq, isNull } from "drizzle-orm";

export const runtime = "nodejs";

async function requireAdmin() {
  const s = await getSession();
  if (!s.userId || s.role !== "admin") return null;
  return s;
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const onlyOpen = url.searchParams.get("open") !== "0";

  const rows = await db
    .select()
    .from(alerts)
    .where(onlyOpen ? isNull(alerts.acknowledgedAt) : undefined)
    .orderBy(desc(alerts.createdAt))
    .limit(500);

  // Hydrate related issued invoice (if any)
  const inv = await db.select().from(issuedInvoices);
  const invMap = new Map(inv.map((i) => [i.id, i]));

  const data = rows.map((a) => ({
    ...a,
    invoice: a.relatedIssuedInvoiceId ? invMap.get(a.relatedIssuedInvoiceId) ?? null : null,
  }));
  return NextResponse.json({ alerts: data });
}

const ackSchema = z.object({ id: z.number().int().positive() });

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = ackSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });

  await db
    .update(alerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: s.userId! })
    .where(eq(alerts.id, parsed.data.id));
  return NextResponse.json({ ok: true });
}
