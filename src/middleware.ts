import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "*")
);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get("origin");

  // Tighten CORS on API routes: explicit origin allowlist, never '*' with credentials
  if (pathname.startsWith("/api/")) {
    const isAllowedOrigin = !origin || origin === req.nextUrl.origin || ALLOWED_ORIGINS.has(origin);

    if (req.method === "OPTIONS") {
      if (!isAllowedOrigin) {
        return new NextResponse(null, { status: 403 });
      }
      const preflight = new NextResponse(null, { status: 204 });
      if (origin) {
        preflight.headers.set("Access-Control-Allow-Origin", origin);
        preflight.headers.set("Access-Control-Allow-Credentials", "true");
        preflight.headers.set("Vary", "Origin");
      }
      preflight.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      preflight.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, X-CSRF-Token, X-Requested-With"
      );
      preflight.headers.set("Access-Control-Max-Age", "600");
      return preflight;
    }

    if (origin && !isAllowedOrigin && !pathname.startsWith("/api/webhooks/")) {
      return NextResponse.json({ error: "CORS origin not allowed." }, { status: 403 });
    }

    const res = NextResponse.next();
    if (origin && isAllowedOrigin) {
      res.headers.set("Access-Control-Allow-Origin", origin);
      res.headers.set("Access-Control-Allow-Credentials", "true");
      res.headers.set("Vary", "Origin");
    }
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
