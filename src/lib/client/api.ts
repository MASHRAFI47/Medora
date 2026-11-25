"use client";

let cachedCsrfToken: string | null = null;

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("medora_csrf_token="));
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null;
}

export async function ensureCsrfToken(): Promise<string> {
  const fromCookie = readCsrfCookie();
  if (fromCookie) {
    cachedCsrfToken = fromCookie;
    return fromCookie;
  }
  if (cachedCsrfToken) return cachedCsrfToken;

  const res = await fetch("/api/security/csrf", {
    method: "GET",
    credentials: "same-origin",
  });
  if (res.ok) {
    const data = (await res.json()) as { csrfToken?: string };
    if (data.csrfToken) {
      cachedCsrfToken = data.csrfToken;
      return data.csrfToken;
    }
  }
  return "";
}

/**
 * Safe same-origin fetch wrapper that automatically attaches double-submit CSRF tokens
 * on state-changing requests. Auth sessions live strictly in httpOnly cookies.
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: T & { error?: string; message?: string } }> {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});

  if (method !== "GET" && method !== "HEAD") {
    const csrf = await ensureCsrfToken();
    if (csrf) {
      headers.set("X-CSRF-Token", csrf);
    }
    if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  const res = await fetch(url, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
  });

  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  return { ok: res.ok, status: res.status, data };
}

export function formatMoney(cents: number, currency = "BDT"): string {
  const amount = (cents / 100).toFixed(2);
  return `${currency} ${amount}`;
}
