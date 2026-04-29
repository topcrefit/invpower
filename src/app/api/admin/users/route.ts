import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export const runtime = "nodejs";

async function requireAdmin() {
  const s = await getSession();
  if (!s.userId || s.role !== "admin") return null;
  return s;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(asc(users.id));
  return NextResponse.json({ users: rows });
}

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().optional(),
  role: z.enum(["admin", "user"]).default("user"),
});

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const exists = await db.select().from(users).where(eq(users.email, parsed.data.email));
  if (exists.length > 0) {
    return NextResponse.json({ error: "אימייל כבר קיים" }, { status: 409 });
  }

  const hash = await bcrypt.hash(parsed.data.password, 12);
  const [u] = await db
    .insert(users)
    .values({
      email: parsed.data.email,
      passwordHash: hash,
      fullName: parsed.data.fullName,
      role: parsed.data.role,
      isActive: true,
    })
    .returning();
  return NextResponse.json({ ok: true, user: { ...u, passwordHash: undefined } });
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  isActive: z.boolean().optional(),
  role: z.enum(["admin", "user"]).optional(),
  password: z.string().min(6).optional(),
  fullName: z.string().optional(),
});

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive;
  if (parsed.data.role !== undefined) data.role = parsed.data.role;
  if (parsed.data.fullName !== undefined) data.fullName = parsed.data.fullName;
  if (parsed.data.password) data.passwordHash = await bcrypt.hash(parsed.data.password, 12);

  await db.update(users).set(data).where(eq(users.id, parsed.data.id));
  return NextResponse.json({ ok: true });
}
