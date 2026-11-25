import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import {
  generateGeneratorCode,
  hashSecret,
  validateStrongPassword,
  verifySecret,
} from "@/lib/security/crypto";
import { normalizePhone, normalizeUsername, sanitizeText } from "@/lib/security/sanitize";
import { recordAuditEvent } from "@/lib/security/audit";

const updateProfileSchema = z.object({
  action: z.enum(["UPDATE_PROFILE", "CHANGE_USERNAME", "CHANGE_PASSWORD", "REGENERATE_CODE"]),
  fullName: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(7).max(20).optional(),
  dateOfBirth: z.string().trim().optional(),
  address: z.string().trim().max(250).optional(),
  allergies: z.string().trim().max(400).optional(),
  emergencyContact: z.string().trim().max(160).optional(),
  newUsername: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(12).max(128).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { roles: ["PATIENT"], skipCsrf: true });
  if (!auth.ok) return auth.response;

  const data = await withRlsContext(auth.ctx.rls, async (client) => {
    const res = await client.query(
      `SELECT u.id, u.email, u.username, u.username_changed_at, u.phone, u.phone_verified,
              u.full_name, u.mfa_enabled, u.must_change_password,
              p.id AS patient_id, p.patient_uid, p.date_of_birth, p.address,
              p.emergency_contact, p.allergies, p.generator_code_updated_at
       FROM users u
       JOIN patients p ON p.user_id = u.id
       WHERE u.id = $1
       LIMIT 1`,
      [auth.ctx.userId]
    );
    return res.rows[0] ?? null;
  });

  if (!data) {
    return NextResponse.json({ error: "Patient profile not found." }, { status: 404 });
  }

  return NextResponse.json({ profile: data });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiAuth(req, { roles: ["PATIENT"] });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = updateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid profile update." },
      { status: 400 }
    );
  }

  const ip = getClientIp(req.headers);

  try {
    const result = await withRlsContext(auth.ctx.rls, async (client) => {
      const userRes = await client.query<{
        password_hash: string | null;
        username_changed_at: string | null;
      }>("SELECT password_hash, username_changed_at FROM users WHERE id = $1 LIMIT 1", [
        auth.ctx.userId,
      ]);
      const currentUser = userRes.rows[0];
      if (!currentUser) throw new Error("NOT_FOUND");

      if (parsed.data.action === "UPDATE_PROFILE") {
        if (parsed.data.fullName || parsed.data.phone) {
          await client.query(
            `UPDATE users
             SET full_name = COALESCE($1, full_name),
                 phone = COALESCE($2, phone),
                 updated_at = NOW()
             WHERE id = $3`,
            [
              parsed.data.fullName ? sanitizeText(parsed.data.fullName, 120) : null,
              parsed.data.phone ? normalizePhone(parsed.data.phone) : null,
              auth.ctx.userId,
            ]
          );
        }
        await client.query(
          `UPDATE patients
           SET date_of_birth = COALESCE($1, date_of_birth),
               address = COALESCE($2, address),
               allergies = COALESCE($3, allergies),
               emergency_contact = COALESCE($4, emergency_contact),
               updated_at = NOW()
           WHERE user_id = $5`,
          [
            parsed.data.dateOfBirth || null,
            parsed.data.address !== undefined ? sanitizeText(parsed.data.address, 250) : null,
            parsed.data.allergies !== undefined ? sanitizeText(parsed.data.allergies, 400) : null,
            parsed.data.emergencyContact !== undefined
              ? sanitizeText(parsed.data.emergencyContact, 160)
              : null,
            auth.ctx.userId,
          ]
        );
        return { message: "Profile updated." };
      }

      // Security-sensitive operations require password re-authentication
      if (
        !parsed.data.currentPassword ||
        !verifySecret(parsed.data.currentPassword, currentUser.password_hash)
      ) {
        throw new Error("REAUTH_REQUIRED");
      }

      if (parsed.data.action === "CHANGE_USERNAME") {
        if (currentUser.username_changed_at) {
          throw new Error("USERNAME_ALREADY_CHANGED");
        }
        if (!parsed.data.newUsername) throw new Error("INVALID_USERNAME");
        const nextUsername = normalizeUsername(parsed.data.newUsername);
        const dup = await client.query(
          "SELECT id FROM users WHERE LOWER(username) = $1 AND id <> $2 LIMIT 1",
          [nextUsername, auth.ctx.userId]
        );
        if (dup.rowCount && dup.rowCount > 0) throw new Error("USERNAME_TAKEN");

        await client.query(
          "UPDATE users SET username = $1, username_changed_at = NOW(), updated_at = NOW() WHERE id = $2",
          [nextUsername, auth.ctx.userId]
        );
        await recordAuditEvent(
          {
            actorUserId: auth.ctx.userId,
            actorRole: "PATIENT",
            action: "PATIENT_USERNAME_CHANGED",
            resourceType: "USER",
            resourceId: auth.ctx.userId,
            outcome: "SUCCESS",
            ipAddress: ip,
          },
          client
        );
        return { message: "Username updated (one-time change used).", username: nextUsername };
      }

      if (parsed.data.action === "CHANGE_PASSWORD") {
        if (!parsed.data.newPassword) throw new Error("WEAK_PASSWORD");
        const pwCheck = validateStrongPassword(parsed.data.newPassword);
        if (!pwCheck.valid) throw new Error(`PW:${pwCheck.reason}`);
        const nextHash = hashSecret(parsed.data.newPassword);
        await client.query(
          "UPDATE users SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2",
          [nextHash, auth.ctx.userId]
        );
        await recordAuditEvent(
          {
            actorUserId: auth.ctx.userId,
            actorRole: "PATIENT",
            action: "PASSWORD_CHANGED",
            resourceType: "USER",
            resourceId: auth.ctx.userId,
            outcome: "SUCCESS",
            ipAddress: ip,
          },
          client
        );
        return { message: "Password updated securely." };
      }

      // REGENERATE_CODE: revokes prior generator code and stores only new scrypt verifier
      const newCode = generateGeneratorCode();
      const newCodeHash = hashSecret(newCode);
      await client.query(
        "UPDATE patients SET generator_code_hash = $1, generator_code_updated_at = NOW(), updated_at = NOW() WHERE user_id = $2",
        [newCodeHash, auth.ctx.userId]
      );
      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: "PATIENT",
          action: "GENERATOR_CODE_REGENERATED",
          resourceType: "PATIENT",
          resourceId: auth.ctx.userId,
          outcome: "SUCCESS",
          ipAddress: ip,
        },
        client
      );
      return {
        message: "Previous Prescription Generator Code revoked. Save your new code safely.",
        generatorCode: newCode,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "REAUTH_REQUIRED") {
        return NextResponse.json(
          { error: "Current password verification failed." },
          { status: 403 }
        );
      }
      if (err.message === "USERNAME_ALREADY_CHANGED") {
        return NextResponse.json(
          { error: "Username can only be changed once per patient account." },
          { status: 409 }
        );
      }
      if (err.message === "USERNAME_TAKEN") {
        return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
      }
      if (err.message.startsWith("PW:")) {
        return NextResponse.json({ error: err.message.slice(3) }, { status: 400 });
      }
    }
    return NextResponse.json({ error: "Failed to update profile." }, { status: 500 });
  }
}
