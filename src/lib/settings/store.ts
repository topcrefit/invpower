import { db } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt, encrypt } from "@/lib/crypto";

export const SETTING_KEYS = {
  CARDCOM_TERMINAL_NUMBER: "cardcom.terminal_number",
  CARDCOM_API_NAME: "cardcom.api_name",
  CARDCOM_API_PASSWORD: "cardcom.api_password",
  FIREBERRY_TOKEN: "fireberry.token",
  FIREBERRY_BASE_URL: "fireberry.base_url",
  CARDCOM_BASE_URL: "cardcom.base_url",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

const DEFAULTS: Partial<Record<SettingKey, string>> = {
  [SETTING_KEYS.CARDCOM_BASE_URL]: "https://secure.cardcom.solutions",
  [SETTING_KEYS.FIREBERRY_BASE_URL]: "https://api.powerlink.co.il",
};

export async function getSetting(key: SettingKey): Promise<string | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  if (rows.length === 0) return DEFAULTS[key] ?? null;
  const row = rows[0];
  if (row.isSecret) {
    try {
      return decrypt(row.value);
    } catch {
      return null;
    }
  }
  return row.value;
}

export async function setSetting(
  key: SettingKey,
  value: string,
  userId: number,
  isSecret = true
) {
  const stored = isSecret ? encrypt(value) : value;
  const existing = await db.select().from(settings).where(eq(settings.key, key));
  if (existing.length === 0) {
    await db.insert(settings).values({
      key,
      value: stored,
      isSecret,
      updatedBy: userId,
      updatedAt: new Date(),
    });
  } else {
    await db
      .update(settings)
      .set({ value: stored, isSecret, updatedBy: userId, updatedAt: new Date() })
      .where(eq(settings.key, key));
  }
}

export async function getAllPublicSettingsStatus() {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, true]));
  return Object.values(SETTING_KEYS).map((k) => ({
    key: k,
    isSet: map.has(k) || !!DEFAULTS[k],
    isSecret: !DEFAULTS[k],
  }));
}

export async function getCardcomCreds() {
  const [terminal, apiName, apiPassword, baseUrl] = await Promise.all([
    getSetting(SETTING_KEYS.CARDCOM_TERMINAL_NUMBER),
    getSetting(SETTING_KEYS.CARDCOM_API_NAME),
    getSetting(SETTING_KEYS.CARDCOM_API_PASSWORD),
    getSetting(SETTING_KEYS.CARDCOM_BASE_URL),
  ]);
  if (!apiName || !apiPassword) return null;
  return {
    terminalNumber: terminal ? Number(terminal) : undefined,
    apiName,
    apiPassword,
    baseUrl: baseUrl || "https://secure.cardcom.solutions",
  };
}

export async function getFireberryCreds() {
  const [token, baseUrl] = await Promise.all([
    getSetting(SETTING_KEYS.FIREBERRY_TOKEN),
    getSetting(SETTING_KEYS.FIREBERRY_BASE_URL),
  ]);
  if (!token) return null;
  return { token, baseUrl: baseUrl || "https://api.fireberry.com" };
}
