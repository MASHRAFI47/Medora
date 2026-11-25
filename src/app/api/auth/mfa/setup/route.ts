import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { querySystem } from "@/lib/db";
import { encryptText } from "@/lib/security/crypto";
import { buildTotpSetupPayload, generateTotpSecret } from "@/lib/security/totp";
import { checkRateLimit } from "@/lib/security/rate-limit";

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req);
  if (!auth.ok) return auth.response;

  const rl = await checkRateLimit(`mfa:setup:${auth.ctx.userId}`, 6, 600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many MFA setup attempts." }, { status: 429 });
  }

  const secret = generateTotpSecret();
  const encryptedSecret = encryptText(secret);

  // Store pending encrypted secret until verified by a valid 6-digit TOTP code
  await querySystem(
    "UPDATE users SET mfa_secret_encrypted = $1, updated_at = NOW() WHERE id = $2",
    [encryptedSecret, auth.ctx.userId]
  );

  const payload = await buildTotpSetupPayload(auth.ctx.username, secret);

  return NextResponse.json({
    secret,
    qrDataUrl: payload.qrDataUrl,
    otpauthUrl: payload.otpauthUrl,
    instructions:
      "Scan this QR code in Google Authenticator, Authy, or 1Password, then enter the 6-digit code to enable Multi-Factor Authentication.",
  });
}
