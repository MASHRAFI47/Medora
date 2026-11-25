import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, querySystem } from "@/lib/db";
import { decryptText, hashSecret, verifySecret } from "@/lib/security/crypto";
import { generateRecoveryCodes, verifyTotpCode } from "@/lib/security/totp";
import { recordAuditEvent } from "@/lib/security/audit";
import { checkRateLimit } from "@/lib/security/rate-limit";

const mfaVerifySchema = z.object({
  action: z.enum(["ENABLE", "DISABLE"]),
  totpCode: z.string().trim().min(6).max(16),
  currentPassword: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req);
  if (!auth.ok) return auth.response;

  const rl = await checkRateLimit(`mfa:verify:${auth.ctx.userId}`, 10, 300);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many MFA verification attempts." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = mfaVerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid MFA verification payload." }, { status: 400 });
  }

  const res = await querySystem<{
    mfa_secret_encrypted: string | null;
    password_hash: string | null;
  }>("SELECT mfa_secret_encrypted, password_hash FROM users WHERE id = $1 LIMIT 1", [
    auth.ctx.userId,
  ]);
  const user = res.rows[0];
  if (!user?.mfa_secret_encrypted) {
    return NextResponse.json({ error: "Start MFA setup before verifying a code." }, { status: 400 });
  }

  const secret = decryptText(user.mfa_secret_encrypted);
  if (!verifyTotpCode(secret, parsed.data.totpCode)) {
    return NextResponse.json({ error: "Invalid 6-digit authenticator code." }, { status: 400 });
  }

  const ip = getClientIp(req.headers);

  if (parsed.data.action === "DISABLE") {
    if (!parsed.data.currentPassword || !verifySecret(parsed.data.currentPassword, user.password_hash)) {
      return NextResponse.json(
        { error: "Current password is required to disable MFA." },
        { status: 403 }
      );
    }

    await querySystem(
      "UPDATE users SET mfa_enabled = FALSE, mfa_secret_encrypted = NULL, mfa_recovery_hashes = '[]'::jsonb, updated_at = NOW() WHERE id = $1",
      [auth.ctx.userId]
    );
    await recordAuditEvent({
      actorUserId: auth.ctx.userId,
      actorRole: auth.ctx.role,
      hospitalId: auth.ctx.activeHospitalId,
      action: "MFA_DISABLED",
      resourceType: "USER",
      resourceId: auth.ctx.userId,
      outcome: "SUCCESS",
      ipAddress: ip,
    });
    return NextResponse.json({ message: "Multi-Factor Authentication has been disabled." });
  }

  const recoveryCodes = generateRecoveryCodes(8);
  const hashedRecoveryCodes = recoveryCodes.map((c) => hashSecret(c));

  await querySystem(
    "UPDATE users SET mfa_enabled = TRUE, mfa_recovery_hashes = $1::jsonb, updated_at = NOW() WHERE id = $2",
    [JSON.stringify(hashedRecoveryCodes), auth.ctx.userId]
  );

  await recordAuditEvent({
    actorUserId: auth.ctx.userId,
    actorRole: auth.ctx.role,
    hospitalId: auth.ctx.activeHospitalId,
    action: "MFA_ENABLED",
    resourceType: "USER",
    resourceId: auth.ctx.userId,
    outcome: "SUCCESS",
    ipAddress: ip,
  });

  return NextResponse.json({
    message: "Multi-Factor Authentication is now active.",
    recoveryCodes,
  });
}
