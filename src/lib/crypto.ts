import crypto from "node:crypto";

const ALG = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.SETTINGS_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("SETTINGS_ENC_KEY must be 32 bytes (64 hex chars)");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(blob: string): string {
  const [ivB64, tagB64, encB64] = blob.split(":");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("Invalid ciphertext");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const decipher = crypto.createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
