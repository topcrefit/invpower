import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { getAllPublicSettingsStatus, setSetting, SETTING_KEYS } from "@/lib/settings/store";

export const runtime = "nodejs";

async function requireAdmin() {
  const s = await getSession();
  if (!s.userId || s.role !== "admin") return null;
  return s;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const status = await getAllPublicSettingsStatus();
  return NextResponse.json({ settings: status });
}

const schema = z.object({
  cardcomTerminalNumber: z.string().optional(),
  cardcomApiName: z.string().optional(),
  cardcomApiPassword: z.string().optional(),
  cardcomBaseUrl: z.string().optional(),
  fireberryToken: z.string().optional(),
  fireberryBaseUrl: z.string().optional(),
});

export async function POST(req: Request) {
  const s = await requireAdmin();
  if (!s) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const d = parsed.data;
  const uid = s.userId!;

  if (d.cardcomTerminalNumber)
    await setSetting(SETTING_KEYS.CARDCOM_TERMINAL_NUMBER, d.cardcomTerminalNumber, uid, true);
  if (d.cardcomApiName)
    await setSetting(SETTING_KEYS.CARDCOM_API_NAME, d.cardcomApiName, uid, true);
  if (d.cardcomApiPassword)
    await setSetting(SETTING_KEYS.CARDCOM_API_PASSWORD, d.cardcomApiPassword, uid, true);
  if (d.cardcomBaseUrl)
    await setSetting(SETTING_KEYS.CARDCOM_BASE_URL, d.cardcomBaseUrl, uid, false);
  if (d.fireberryToken)
    await setSetting(SETTING_KEYS.FIREBERRY_TOKEN, d.fireberryToken, uid, true);
  if (d.fireberryBaseUrl)
    await setSetting(SETTING_KEYS.FIREBERRY_BASE_URL, d.fireberryBaseUrl, uid, false);

  return NextResponse.json({ ok: true });
}
