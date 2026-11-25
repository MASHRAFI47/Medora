import { NextRequest, NextResponse } from "next/server";
import { getClientIp, withRlsContext } from "@/lib/db";
import { activateAccountSchema } from "@/lib/validators/schemas";
import {
  generateGeneratorCode,
  hashSecret,
  validateStrongPassword,
  verifySecret,
} from "@/lib/security/crypto";
import { normalizeUsername, sanitizeText } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { verifyCsrfRequest } from "@/lib/security/csrf";
import { recordAuditEvent } from "@/lib/security/audit";

export async function POST(req: NextRequest) {
  const csrf = verifyCsrfRequest(req);
  if (!csrf.ok) {
    return NextResponse.json({ error: csrf.reason }, { status: 403 });
  }

  const ip = getClientIp(req.headers);
  const rl = await checkRateLimit(`activate:${ip}`, 10, 600);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many activation attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = activateAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid activation request." },
      { status: 400 }
    );
  }

  const pwCheck = validateStrongPassword(parsed.data.password);
  if (!pwCheck.valid) {
    return NextResponse.json({ error: pwCheck.reason }, { status: 400 });
  }

  const code = parsed.data.activationCode.trim();
  const prefix = code.slice(0, 8);
  const passwordHash = hashSecret(parsed.data.password);
  const generatorCode = generateGeneratorCode();
  const generatorCodeHash = hashSecret(generatorCode);

  try {
    const activated = await withRlsContext({ bypassRls: true }, async (client) => {
      const candidates = await client.query<{
        id: string;
        patient_id: string;
        user_id: string;
        token_hash: string;
        expires_at: string;
        username: string;
        patient_uid: string;
      }>(
        `SELECT t.id, t.patient_id, t.user_id, t.token_hash, t.expires_at, u.username, p.patient_uid
         FROM patient_activation_tokens t
         JOIN users u ON u.id = t.user_id
         JOIN patients p ON p.id = t.patient_id
         WHERE t.lookup_prefix = $1 AND t.used_at IS NULL AND t.expires_at > NOW()`,
        [prefix]
      );

      const match = candidates.rows.find((row) => verifySecret(code, row.token_hash));
      if (!match) {
        await recordAuditEvent(
          {
            action: "PATIENT_ACTIVATION_FAILED",
            resourceType: "PATIENT_ACTIVATION",
            outcome: "FAILURE",
            ipAddress: ip,
          },
          client
        );
        throw new Error("INVALID_TOKEN");
      }

      const desiredUsername = parsed.data.username
        ? normalizeUsername(parsed.data.username)
        : match.username;

      if (desiredUsername !== match.username) {
        const dup = await client.query(
          "SELECT id FROM users WHERE LOWER(username) = $1 AND id <> $2 LIMIT 1",
          [desiredUsername, match.user_id]
        );
        if (dup.rowCount && dup.rowCount > 0) {
          throw new Error("USERNAME_TAKEN");
        }
      }

      const email = parsed.data.email ? parsed.data.email.trim().toLowerCase() : null;
      if (email) {
        const dupEmail = await client.query(
          "SELECT id FROM users WHERE LOWER(email) = $1 AND id <> $2 LIMIT 1",
          [email, match.user_id]
        );
        if (dupEmail.rowCount && dupEmail.rowCount > 0) {
          throw new Error("EMAIL_TAKEN");
        }
      }

      await client.query(
        `UPDATE users
         SET username = $1,
             email = COALESCE($2, email),
             password_hash = $3,
             account_status = 'ACTIVE',
             updated_at = NOW()
         WHERE id = $4`,
        [desiredUsername, email, passwordHash, match.user_id]
      );

      await client.query(
        `UPDATE patients
         SET date_of_birth = COALESCE($1, date_of_birth),
             address = COALESCE($2, address),
             generator_code_hash = $3,
             generator_code_updated_at = NOW(),
             updated_at = NOW()
         WHERE id = $4`,
        [
          parsed.data.dateOfBirth || null,
          parsed.data.address ? sanitizeText(parsed.data.address, 250) : null,
          generatorCodeHash,
          match.patient_id,
        ]
      );

      await client.query(
        "UPDATE patient_activation_tokens SET used_at = NOW() WHERE id = $1",
        [match.id]
      );

      await recordAuditEvent(
        {
          actorUserId: match.user_id,
          actorRole: "PATIENT",
          action: "PATIENT_ACCOUNT_ACTIVATED",
          resourceType: "PATIENT",
          resourceId: match.patient_uid,
          outcome: "SUCCESS",
          ipAddress: ip,
        },
        client
      );

      return { username: desiredUsername, patientUid: match.patient_uid };
    });

    return NextResponse.json({
      message: "Account activated successfully. You can now sign in with your new password.",
      username: activated.username,
      patientUid: activated.patientUid,
      generatorCode,
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "INVALID_TOKEN") {
        return NextResponse.json(
          { error: "Activation code is invalid, already used, or expired." },
          { status: 400 }
        );
      }
      if (err.message === "USERNAME_TAKEN") {
        return NextResponse.json({ error: "That username is already in use." }, { status: 409 });
      }
      if (err.message === "EMAIL_TAKEN") {
        return NextResponse.json({ error: "That email address is already registered." }, { status: 409 });
      }
    }
    return NextResponse.json({ error: "Could not complete account activation." }, { status: 500 });
  }
}
