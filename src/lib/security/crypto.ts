import "server-only";
import crypto from "node:crypto";
import { serverEnv } from "@/lib/env";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashSecret(plaintext: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .scryptSync(plaintext, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
    .toString("hex");
  return `$scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived}`;
}

export function verifySecret(plaintext: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.startsWith("$scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 7) return false;
  const N = Number(parts[2]);
  const r = Number(parts[3]);
  const p = Number(parts[4]);
  const salt = parts[5];
  const expectedHex = parts[6];
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !salt || !expectedHex) {
    return false;
  }
  const derived = crypto.scryptSync(plaintext, salt, KEY_LEN, { N, r, p });
  const expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function encryptText(plaintext: string): string {
  const key = Buffer.from(serverEnv.encryptionKeyHex.slice(0, 64), "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptText(ciphertext: string): string {
  const [ivHex, tagHex, dataHex] = ciphertext.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Invalid encrypted payload format");
  }
  const key = Buffer.from(serverEnv.encryptionKeyHex.slice(0, 64), "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function generateGeneratorCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return `MED-${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

export function generateActivationCode(): { fullCode: string; prefix: string } {
  const raw = crypto.randomBytes(9).toString("base64url").toUpperCase();
  const fullCode = `ACT-${raw}`;
  return { fullCode, prefix: fullCode.slice(0, 8) };
}

export function generateNumericOtp(digits = 6): string {
  const max = 10 ** digits;
  const num = crypto.randomInt(0, max);
  return String(num).padStart(digits, "0");
}

export function generateHumanId(prefix: string): string {
  const rand = crypto.randomInt(100000, 999999);
  const suffix = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${prefix}-${rand}${suffix}`;
}

const COMMON_WEAK_PASSWORDS = new Set([
  "password123!",
  "admin123456!",
  "medora123456!",
  "qwerty123456!",
  "welcome12345!",
]);

export function validateStrongPassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 12) {
    return { valid: false, reason: "Password must be at least 12 characters long." };
  }
  if (password.length > 128) {
    return { valid: false, reason: "Password must not exceed 128 characters." };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, reason: "Password must include at least one lowercase letter." };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, reason: "Password must include at least one uppercase letter." };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, reason: "Password must include at least one number." };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, reason: "Password must include at least one special character." };
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    return { valid: false, reason: "Password is too common. Choose a stronger unique password." };
  }
  return { valid: true };
}
