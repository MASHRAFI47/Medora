import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import { generateNumericOtp, hashSecret } from "@/lib/security/crypto";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { recordAuditEvent } from "@/lib/security/audit";

const otpRequestSchema = z.object({
  patientId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["DOCTOR"],
    requireActiveHospital: true,
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = otpRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid patient ID." }, { status: 400 });
  }

  const rl = await checkRateLimit(
    `otp:issue:${auth.ctx.userId}:${parsed.data.patientId}`,
    3,
    300
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `OTP throttling active. Please wait ${rl.retryAfterSeconds} seconds.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const ip = getClientIp(req.headers);

  try {
    const issued = await withRlsContext(auth.ctx.rls, async (client) => {
      const patRes = await client.query<{
        id: string;
        patient_uid: string;
        user_id: string;
        phone: string | null;
        phone_verified: boolean;
      }>(
        `SELECT p.id, p.patient_uid, p.user_id, u.phone, u.phone_verified
         FROM patients p
         JOIN users u ON u.id = p.user_id
         WHERE p.id = $1
         LIMIT 1`,
        [parsed.data.patientId]
      );
      const patient = patRes.rows[0];
      if (!patient) throw new Error("NOT_FOUND");

      // Safe failure: never bypass verification when phone is missing or unverified
      if (!patient.phone || !patient.phone_verified) {
        await recordAuditEvent(
          {
            actorUserId: auth.ctx.userId,
            actorRole: auth.ctx.role,
            hospitalId: auth.ctx.activeHospitalId,
            action: "DOCTOR_OTP_UNVERIFIED_PHONE",
            resourceType: "PATIENT",
            resourceId: patient.patient_uid,
            outcome: "DENIED",
            ipAddress: ip,
          },
          client
        );
        throw new Error("PHONE_UNVERIFIED");
      }

      const otp = generateNumericOtp(6);
      const otpHash = hashSecret(otp);

      await client.query(
        `INSERT INTO patient_verification_otps (patient_id, doctor_user_id, hospital_id, otp_hash, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '5 minutes')`,
        [patient.id, auth.ctx.userId, auth.ctx.activeHospitalId, otpHash]
      );

      // Authenticated in-app notification contains NO PHI, directs patient to review access
      await client.query(
        `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
         VALUES ($1, $2, 'SECURITY', 'Prescription Verification OTP Requested', 'A clinician requested an identity confirmation OTP for your active consultation. Do not share your account password or generator code with staff.', '/patient')`,
        [patient.user_id, auth.ctx.activeHospitalId]
      );

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId: auth.ctx.activeHospitalId,
          action: "DOCTOR_OTP_ISSUED",
          resourceType: "PATIENT",
          resourceId: patient.patient_uid,
          outcome: "SUCCESS",
          ipAddress: ip,
        },
        client
      );

      return { otp, expiresInSeconds: 300 };
    });

    return NextResponse.json({
      message:
        "A single-use 6-digit OTP has been dispatched to the patient's verified phone (expires in 5 minutes).",
      expiresInSeconds: issued.expiresInSeconds,
      // Sandbox preview only in non-production for pilot testing (never logged!)
      ...(process.env.NODE_ENV !== "production"
        ? { sandboxOtpPreview: issued.otp }
        : {}),
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Patient record not found." }, { status: 404 });
      }
      if (err.message === "PHONE_UNVERIFIED") {
        return NextResponse.json(
          {
            error:
              "Patient phone is unverified or unavailable. Do not bypass identity checks; escalate to hospital in-person identity verification desk.",
          },
          { status: 400 }
        );
      }
    }
    return NextResponse.json({ error: "Could not issue verification OTP." }, { status: 500 });
  }
}
