import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "פרטי התחברות לא תקינים" }, { status: 400 });
  }
  const { email, password, rememberMe } = parsed.data;

  const rows = await db.select().from(users).where(eq(users.email, email));
  const user = rows[0];
  if (!user || !user.isActive) {
    return NextResponse.json({ error: "שם משתמש או סיסמה שגויים" }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "שם משתמש או סיסמה שגויים" }, { status: 401 });
  }

  const session = await getSession(rememberMe);
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role;
  session.rememberMe = rememberMe;
  await session.save();

  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
  });
}
