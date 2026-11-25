import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import { provisionPatientSchema } from "@/lib/validators/schemas";
import {
  generateActivationCode,
  generateHumanId,
  hashSecret,
} from "@/lib/security/crypto";
import { normalizePhone, sanitizeText } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { recordAuditEvent } from "@/lib/security/audit";
import { createVerificationProof } from "@/app/api/doctor/patients/verify/route";

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["DOCTOR"],
    requireActiveHospital: true,
  });
  if (!auth.ok) return auth.response;

  const rl = await checkRateLimit(`doctor:provision:${auth.ctx.userId}`, 15, 600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Provisioning rate limit reached." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = provisionPatientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid patient details." },
      { status: 400 }
    );
  }

  const fullName = sanitizeText(parsed.data.fullName, 120);
  const phone = normalizePhone(parsed.data.phone);
  const address = parsed.data.address ? sanitizeText(parsed.data.address, 250) : null;
  const patientUid = generateHumanId("MED-PAT");
  const tempUsername = `pat_${patientUid.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const { fullCode, prefix } = generateActivationCode();
  const tokenHash = hashSecret(fullCode);
  const ip = getClientIp(req.headers);

  try {
    const provisioned = await withRlsContext({ bypassRls: true }, async (client) => {
      // Prevent accidental duplicate accounts on verified phone numbers
      const existing = await client.query(
        "SELECT id FROM users WHERE phone = $1 AND primary_role = 'PATIENT' LIMIT 1",
        [phone]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw new Error("DUPLICATE_PHONE");
      }

      // No plaintext password is ever generated or stored! Account stays PENDING_ACTIVATION
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO users (username, phone, phone_verified, full_name, password_hash, primary_role, account_status)
         VALUES ($1, $2, TRUE, $3, NULL, 'PATIENT', 'PENDING_ACTIVATION')
         RETURNING id`,
        [tempUsername, phone, fullName]
      );
      const userId = userRes.rows[0].id;

      const patRes = await client.query<{ id: string }>(
        `INSERT INTO patients (patient_uid, user_id, date_of_birth, address, provisioned_by_doctor_id, provisioned_hospital_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          patientUid,
          userId,
          parsed.data.dateOfBirth || null,
          address,
          auth.ctx.userId,
          auth.ctx.activeHospitalId,
        ]
      );
      const patientId = patRes.rows[0].id;

      await client.query(
        `INSERT INTO patient_activation_tokens (patient_id, user_id, lookup_prefix, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '48 hours', $5)`,
        [patientId, userId, prefix, tokenHash, auth.ctx.userId]
      );

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId: auth.ctx.activeHospitalId,
          action: "DOCTOR_PROVISIONED_PATIENT",
          resourceType: "PATIENT",
          resourceId: patientUid,
          outcome: "SUCCESS",
          ipAddress: ip,
        },
        client
      );

      return { patientId, patientUid };
    });

    const proof = createVerificationProof(
      auth.ctx.userId,
      auth.ctx.activeHospitalId!,
      provisioned.patientId,
      "NEW_PATIENT_PROVISION"
    );

    return NextResponse.json(
      {
        message:
          "Pending patient identity created. Share the one-time activation code with the patient (expires in 48 hours; patient sets their own password).",
        patient: {
          patientId: provisioned.patientId,
          patientUid: provisioned.patientUid,
          fullName,
          accountStatus: "PENDING_ACTIVATION",
        },
        verificationProof: proof,
        activationCode: fullCode,
        activationPath: `/activate?code=${encodeURIComponent(fullCode)}`,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "DUPLICATE_PHONE") {
      return NextResponse.json(
        {
          error:
            "A patient account already exists for this phone number. Use Existing Patient Lookup instead to avoid duplicate clinical records.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not provision patient account." }, { status: 500 });
  }
}
