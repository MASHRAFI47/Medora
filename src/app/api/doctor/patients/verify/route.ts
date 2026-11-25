import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import { verifyPatientSchema } from "@/lib/validators/schemas";
import { hmacSha256Hex, verifySecret } from "@/lib/security/crypto";
import { serverEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { recordAuditEvent } from "@/lib/security/audit";

export function createVerificationProof(
  doctorUserId: string,
  hospitalId: string,
  patientId: string,
  method: string
): string {
  const exp = Math.floor(Date.now() / 1000) + 15 * 60; // 15-minute clinical session proof
  const payload = `${doctorUserId}:${hospitalId}:${patientId}:${method}:${exp}`;
  const sig = hmacSha256Hex(serverEnv.nextAuthSecret, payload);
  return `${exp}.${sig}`;
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["DOCTOR"],
    requireActiveHospital: true,
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = verifyPatientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid verification request." }, { status: 400 });
  }

  const rl = await checkRateLimit(
    `verify:patient:${auth.ctx.userId}:${parsed.data.patientId}`,
    8,
    300
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many verification attempts. Please wait before retrying." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const ip = getClientIp(req.headers);

  try {
    const verified = await withRlsContext(auth.ctx.rls, async (client) => {
      const patRes = await client.query<{
        id: string;
        patient_uid: string;
        full_name: string;
        date_of_birth: string | null;
        allergies: string | null;
        generator_code_hash: string | null;
      }>(
        `SELECT p.id, p.patient_uid, u.full_name, p.date_of_birth, p.allergies, p.generator_code_hash
         FROM patients p
         JOIN users u ON u.id = p.user_id
         WHERE p.id = $1 LIMIT 1`,
        [parsed.data.patientId]
      );
      const patient = patRes.rows[0];
      if (!patient) throw new Error("NOT_FOUND");

      if (parsed.data.method === "GENERATOR_CODE") {
        const ok = verifySecret(parsed.data.code.trim().toUpperCase(), patient.generator_code_hash);
        if (!ok) {
          await recordAuditEvent(
            {
              actorUserId: auth.ctx.userId,
              actorRole: auth.ctx.role,
              hospitalId: auth.ctx.activeHospitalId,
              action: "PATIENT_GENERATOR_CODE_FAILED",
              resourceType: "PATIENT",
              resourceId: patient.patient_uid,
              outcome: "FAILURE",
              ipAddress: ip,
            },
            client
          );
          throw new Error("INVALID_CODE");
        }
      } else {
        // Verify single-use OTP bound to this patient, doctor, and hospital
        const otpRes = await client.query<{
          id: string;
          otp_hash: string;
          attempts: number;
          max_attempts: number;
        }>(
          `SELECT id, otp_hash, attempts, max_attempts
           FROM patient_verification_otps
           WHERE patient_id = $1
             AND doctor_user_id = $2
             AND hospital_id = $3
             AND verified_at IS NULL
             AND expires_at > NOW()
           ORDER BY created_at DESC
           LIMIT 1`,
          [patient.id, auth.ctx.userId, auth.ctx.activeHospitalId]
        );
        const otpRow = otpRes.rows[0];
        if (!otpRow || otpRow.attempts >= otpRow.max_attempts) {
          throw new Error("OTP_EXPIRED");
        }
        const ok = verifySecret(parsed.data.code.trim(), otpRow.otp_hash);
        if (!ok) {
          await client.query(
            "UPDATE patient_verification_otps SET attempts = attempts + 1 WHERE id = $1",
            [otpRow.id]
          );
          await recordAuditEvent(
            {
              actorUserId: auth.ctx.userId,
              actorRole: auth.ctx.role,
              hospitalId: auth.ctx.activeHospitalId,
              action: "PATIENT_OTP_FAILED",
              resourceType: "PATIENT",
              resourceId: patient.patient_uid,
              outcome: "FAILURE",
              ipAddress: ip,
            },
            client
          );
          throw new Error("INVALID_CODE");
        }
        await client.query(
          "UPDATE patient_verification_otps SET verified_at = NOW() WHERE id = $1",
          [otpRow.id]
        );
      }

      const proof = createVerificationProof(
        auth.ctx.userId,
        auth.ctx.activeHospitalId!,
        patient.id,
        parsed.data.method
      );

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId: auth.ctx.activeHospitalId,
          action: "PATIENT_IDENTITY_VERIFIED",
          resourceType: "PATIENT",
          resourceId: patient.patient_uid,
          outcome: "SUCCESS",
          ipAddress: ip,
          metadata: { method: parsed.data.method },
        },
        client
      );

      return {
        verificationProof: proof,
        patient: {
          patientId: patient.id,
          patientUid: patient.patient_uid,
          fullName: patient.full_name,
          dateOfBirth: patient.date_of_birth,
          allergies: patient.allergies,
        },
      };
    });

    return NextResponse.json(verified);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Patient record not found." }, { status: 404 });
      }
      if (err.message === "OTP_EXPIRED") {
        return NextResponse.json(
          { error: "OTP has expired or exceeded maximum attempts. Request a new OTP." },
          { status: 400 }
        );
      }
      if (err.message === "INVALID_CODE") {
        return NextResponse.json(
          { error: "Identity verification code did not match." },
          { status: 400 }
        );
      }
    }
    return NextResponse.json({ error: "Verification failed." }, { status: 500 });
  }
}
