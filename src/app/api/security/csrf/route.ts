import { NextResponse } from "next/server";
import { createCsrfToken, CSRF_COOKIE_NAME } from "@/lib/security/csrf";
import { serverEnv } from "@/lib/env";

export async function GET() {
  const token = createCsrfToken();
  const res = NextResponse.json({ csrfToken: token });
  res.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Read by same-origin JS to echo in X-CSRF-Token header (double-submit pattern)
    sameSite: "lax",
    secure: serverEnv.nodeEnv === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}
