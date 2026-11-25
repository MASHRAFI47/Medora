import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import { patientLookupSchema } from "@/lib/validators/schemas";
import { normalizePhone, normalizeUsername } from "@/lib/security/sanitize";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { recordAuditEvent } from "@/lib/security/audit";

function maskPhone(phone: string | null): string | null {
  if (!phone || phone.length < 4) return null;
  return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["DOCTOR"],
    requireActiveHospital: true,
  });
  if (!auth.ok) return auth.response;

  const rl = await checkRateLimit(`doctor:lookup:${auth.ctx.userId}`, 30, 300);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Patient lookup rate limit exceeded. Wait before searching again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = patientLookupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a patient username, UID, or phone number." }, { status: 400 });
  }

  const raw = parsed.data.identifier.trim();
  const normUser = normalizeUsername(raw);
  const normPhone = normalizePhone(raw);
  const ip = getClientIp(req.headers);

  const patient = await withRlsContext(auth.ctx.rls, async (client) => {
    const res = await client.query<{
      patient_id: string;
      patient_uid: string;
      full_name: string;
      username: string;
      phone: string | null;
      phone_verified: boolean;
      account_status: string;
      has_generator_code: boolean;
    }>(
      `SELECT p.id AS patient_id, p.patient_uid, u.full_name, u.username, u.phone,
              u.phone_verified, u.account_status,
              (p.generator_code_hash IS NOT NULL) AS has_generator_code
       FROM patients p
       JOIN users u ON u.id = p.user_id
       WHERE LOWER(u.username) = $1
          OR UPPER(p.patient_uid) = UPPER($2)
          OR (u.phone IS NOT NULL AND u.phone = $3)
       LIMIT 1`,
      [normUser, raw, normPhone]
    );

    const found = res.rows[0] ?? null;

    await recordAuditEvent(
      {
        actorUserId: auth.ctx.userId,
        actorRole: auth.ctx.role,
        hospitalId: auth.ctx.activeHospitalId,
        action: "DOCTOR_PATIENT_LOOKUP",
        resourceType: "PATIENT",
        resourceId: found?.patient_uid ?? null,
        outcome: found ? "SUCCESS" : "FAILURE",
        ipAddress: ip,
        metadata: { matched: Boolean(found) },
      },
      client
    );

    return found;
  });

  if (!patient) {
    return NextResponse.json(
      {
        found: false,
        message: "No matching patient found. You may provision a new pending patient account below.",
      },
      { status: 404 }
    );
  }

  // Return minimal identity confirmation data only (no clinical history before identity confirmation!)
  return NextResponse.json({
    found: true,
    patient: {
      patientId: patient.patient_id,
      patientUid: patient.patient_uid,
      fullName: patient.full_name,
      username: patient.username,
      maskedPhone: maskPhone(patient.phone),
      phoneVerified: patient.phone_verified,
      accountStatus: patient.account_status,
      hasGeneratorCode: patient.has_generator_code,
    },
  });
}
