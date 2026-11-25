import { NextRequest, NextResponse } from "next/server";
import { getClientIp, withRlsContext } from "@/lib/db";
import { patientRegisterSchema } from "@/lib/validators/schemas";
import {
  generateGeneratorCode,
  generateHumanId,
  hashSecret,
  validateStrongPassword,
} from "@/lib/security/crypto";
import { normalizePhone, normalizeUsername, sanitizeText } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { verifyCsrfRequest } from "@/lib/security/csrf";
import { recordAuditEvent } from "@/lib/security/audit";

export async function POST(req: NextRequest) {
  const csrf = verifyCsrfRequest(req);
  if (!csrf.ok) {
    return NextResponse.json({ error: csrf.reason }, { status: 403 });
  }

  const ip = getClientIp(req.headers);
  const rl = await checkRateLimit(`register:patient:${ip}`, 10, 900);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = patientRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid registration details." },
      { status: 400 }
    );
  }

  const pwCheck = validateStrongPassword(parsed.data.password);
  if (!pwCheck.valid) {
    return NextResponse.json({ error: pwCheck.reason }, { status: 400 });
  }

  const fullName = sanitizeText(parsed.data.fullName, 120);
  const email = parsed.data.email.trim().toLowerCase();
  const username = normalizeUsername(parsed.data.username);
  const phone = normalizePhone(parsed.data.phone);
  const address = parsed.data.address ? sanitizeText(parsed.data.address, 250) : null;
  const dob = parsed.data.dateOfBirth || null;

  const passwordHash = hashSecret(parsed.data.password);
  const generatorCode = generateGeneratorCode();
  const generatorCodeHash = hashSecret(generatorCode);
  const patientUid = generateHumanId("MED-PAT");

  try {
    const created = await withRlsContext({ bypassRls: true }, async (client) => {
      const existing = await client.query(
        "SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2 LIMIT 1",
        [email, username]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw new Error("CONFLICT");
      }

      const userRes = await client.query<{ id: string }>(
        `INSERT INTO users (email, username, phone, phone_verified, full_name, password_hash, primary_role, account_status)
         VALUES ($1, $2, $3, TRUE, $4, $5, 'PATIENT', 'ACTIVE')
         RETURNING id`,
        [email, username, phone, fullName, passwordHash]
      );
      const userId = userRes.rows[0].id;

      await client.query(
        `INSERT INTO patients (patient_uid, user_id, date_of_birth, address, generator_code_hash, generator_code_updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [patientUid, userId, dob || null, address, generatorCodeHash]
      );

      await recordAuditEvent(
        {
          actorUserId: userId,
          actorRole: "PATIENT",
          action: "PATIENT_SELF_REGISTERED",
          resourceType: "PATIENT",
          resourceId: patientUid,
          outcome: "SUCCESS",
          ipAddress: ip,
        },
        client
      );

      return { userId, patientUid };
    });

    return NextResponse.json(
      {
        message: "Patient account created successfully.",
        patientUid: created.patientUid,
        username,
        // Displayed ONCE to patient on registration; only scrypt hash is stored in PostgreSQL
        generatorCode,
        generatorCodeNotice:
          "Save your Prescription Generator Code securely. It will not be shown again, though you can regenerate a new one anytime in Settings.",
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "CONFLICT") {
      return NextResponse.json(
        { error: "An account with this email or username already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Registration could not be completed." }, { status: 500 });
  }
}
