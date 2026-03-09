import crypto from "node:crypto";

import { requireEnv } from "./env";

const ENCRYPTION_ALGO = "aes-256-gcm";
const IV_BYTE_LENGTH = 12;

function getEncryptionKey() {
  const secret = requireEnv("APP_ENCRYPTION_SECRET");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecretValue(plaintext: string) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTE_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptSecretValue(payload: string) {
  const [ivRaw, tagRaw, ciphertextRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Invalid encrypted value format");
  }

  const key = getEncryptionKey();
  const iv = Buffer.from(ivRaw, "base64");
  const tag = Buffer.from(tagRaw, "base64");
  const ciphertext = Buffer.from(ciphertextRaw, "base64");

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function decryptOptionalSecret(payload?: string | null) {
  if (!payload) {
    return null;
  }

  return decryptSecretValue(payload);
}

export function normalizeSecret(value?: string | null) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function maskSecret(value?: string | null) {
  if (!value) {
    return null;
  }
  if (value.length <= 4) {
    return `${value[0] ?? "*"}**${value.at(-1) ?? "*"}`;
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}
