import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

export type SessionData = {
  userId?: number;
  email?: string;
  role?: "admin" | "user";
  rememberMe?: boolean;
};

const ONE_DAY = 60 * 60 * 24;
const THIRTY_DAYS = ONE_DAY * 30;

export function sessionOptions(rememberMe = false): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 chars");
  }
  return {
    password,
    cookieName: "invpower_session",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: rememberMe ? THIRTY_DAYS : ONE_DAY,
    },
  };
}

export async function getSession(rememberMe = false) {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions(rememberMe));
}

export async function requireUser() {
  const session = await getSession();
  if (!session.userId) return null;
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session.userId || session.role !== "admin") return null;
  return session;
}
