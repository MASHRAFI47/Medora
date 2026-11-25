import "server-only";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { hmacSha256Hex, timingSafeEqualStr } from "@/lib/security/crypto";

export const CSRF_COOKIE_NAME = "medora_csrf_token";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function createCsrfToken(): string {
  const nonce = crypto.randomBytes(24).toString("hex");
  const sig = hmacSha256Hex(serverEnv.csrfSecret, nonce);
  return `${nonce}.${sig}`;
}

export function verifyCsrfTokenSignature(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [nonce, sig] = parts;
  if (!nonce || !sig || nonce.length !== 48) return false;
  const expected = hmacSha256Hex(serverEnv.csrfSecret, nonce);
  return timingSafeEqualStr(sig, expected);
}

/**
 * Verifies Origin/Referer against strict allowlist AND validates double-submit CSRF token when present.
 * Note: Webhook endpoints use HMAC-SHA256 signature verification instead of browser CSRF.
 */
export function verifyCsrfRequest(req: NextRequest): { ok: boolean; reason?: string } {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { ok: true };
  }

  const allowed = new Set(serverEnv.allowedOrigins);
  const reqOrigin = req.nextUrl.origin;
  if (reqOrigin) allowed.add(reqOrigin);

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  if (origin) {
    if (!allowed.has(origin)) {
      return { ok: false, reason: "Disallowed request origin." };
    }
  } else if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!allowed.has(refOrigin)) {
        return { ok: false, reason: "Disallowed request referer." };
      }
    } catch {
      return { ok: false, reason: "Malformed referer header." };
    }
  } else {
    // Reject cross-site form posts lacking Origin/Referer unless explicitly same-site fetch
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "same-site" && secFetchSite !== "none") {
      return { ok: false, reason: "Cross-site state-changing request blocked." };
    }
  }

  // Double-submit token validation when cookie is set
  const cookieToken = req.cookies.get(CSRF_COOKIE_NAME)?.value;
  const headerToken = req.headers.get(CSRF_HEADER_NAME) || undefined;
  if (cookieToken) {
    if (!headerToken || !timingSafeEqualStr(cookieToken, headerToken) || !verifyCsrfTokenSignature(cookieToken)) {
      return { ok: false, reason: "Invalid or missing CSRF token." };
    }
  }

  return { ok: true };
}
