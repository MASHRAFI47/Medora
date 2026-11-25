import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import { createPrescriptionSchema } from "@/lib/validators/schemas";
import {
  generateHumanId,
  hmacSha256Hex,
  timingSafeEqualStr,
} from "@/lib/security/crypto";
import { sanitizeText } from "@/lib/security/sanitize";
import { serverEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { recordAuditEvent } from "@/lib/security/audit";

function verifyProof(
  proof: string | undefined,
  doctorUserId: string,
  hospitalId: string,
  patientId: string,
  method: string
): boolean {
  if (!proof) return false;
  const parts = proof.split(".");
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  const sig = parts[1];
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = hmacSha256Hex(
    serverEnv.nextAuthSecret,
    `${doctorUserId}:${hospitalId}:${patientId}:${method}:${exp}`
  );
  return timingSafeEqualStr(sig, expected);
}

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { skipCsrf: true });
  if (!auth.ok) return auth.response;

  const statusFilter = req.nextUrl.searchParams.get("status")?.trim() || null;

  const prescriptions = await withRlsContext(auth.ctx.rls, async (client) => {
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (auth.ctx.role === "PATIENT") {
      params.push(auth.ctx.userId);
      conditions.push(`pu.id = $${params.length}`);
    } else if (auth.ctx.role === "DOCTOR") {
      if (!auth.ctx.activeHospitalId) return [];
      params.push(auth.ctx.userId, auth.ctx.activeHospitalId);
      conditions.push(`rx.doctor_user_id = $${params.length - 1} AND rx.hospital_id = $${params.length}`);
    } else if (auth.ctx.role === "PHARMACIST") {
      if (!auth.ctx.activeHospitalId || !auth.ctx.activePharmacyId) return [];
      params.push(auth.ctx.activeHospitalId, auth.ctx.activePharmacyId);
      conditions.push(`rx.hospital_id = $${params.length - 1} AND rx.pharmacy_id = $${params.length}`);
    } else if (auth.ctx.role === "HOSPITAL_ADMIN") {
      if (!auth.ctx.activeHospitalId) return [];
      params.push(auth.ctx.activeHospitalId);
      conditions.push(`rx.hospital_id = $${params.length}`);
    }

    if (statusFilter) {
      params.push(statusFilter);
      conditions.push(`rx.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const res = await client.query(
      `SELECT rx.*,
              p.patient_uid,
              pu.full_name AS patient_name,
              pu.username AS patient_username,
              du.full_name AS doctor_name,
              h.name AS hospital_name,
              ph.name AS pharmacy_name,
              ph.address AS pharmacy_address,
              COALESCE(
                (SELECT json_agg(row_to_json(pi) ORDER BY pi.created_at ASC)
                 FROM prescription_items pi WHERE pi.prescription_id = rx.id),
                '[]'::json
              ) AS items,
              (SELECT row_to_json(pay) FROM (
                SELECT id, provider, status, amount_cents, currency, provider_transaction_ref, verified_via_webhook, updated_at
                FROM payments
                WHERE prescription_id = rx.id
                ORDER BY created_at DESC LIMIT 1
              ) pay) AS latest_payment
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       JOIN users pu ON pu.id = p.user_id
       JOIN users du ON du.id = rx.doctor_user_id
       JOIN hospitals h ON h.id = rx.hospital_id
       LEFT JOIN pharmacies ph ON ph.id = rx.pharmacy_id
       ${whereClause}
       ORDER BY rx.created_at DESC
       LIMIT 100`,
      params
    );

    return res.rows;
  });

  return NextResponse.json({ prescriptions });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["DOCTOR"],
    requireActiveHospital: true,
  });
  if (!auth.ok) return auth.response;

  const rl = await checkRateLimit(`rx:create:${auth.ctx.userId}`, 30, 600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Prescription rate limit exceeded." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createPrescriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid prescription form data." },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const hospitalId = auth.ctx.activeHospitalId!;

  // Enforce explicit patient identity confirmation before creating prescription
  if (data.verificationMethod !== "IN_PERSON_ESCALATION") {
    const proofOk = verifyProof(
      data.verificationProof,
      auth.ctx.userId,
      hospitalId,
      data.patientId,
      data.verificationMethod
    );
    if (!proofOk) {
      return NextResponse.json(
        {
          error:
            "Patient identity verification proof is missing or expired. Confirm the patient via Generator Code, OTP, or provisioning first.",
        },
        { status: 403 }
      );
    }
  }

  const rxNumber = generateHumanId("RX-2026");
  const ip = getClientIp(req.headers);

  try {
    const created = await withRlsContext(auth.ctx.rls, async (client) => {
      // Verify patient exists
      const patRes = await client.query<{ id: string; user_id: string; patient_uid: string }>(
        "SELECT id, user_id, patient_uid FROM patients WHERE id = $1 LIMIT 1",
        [data.patientId]
      );
      const patient = patRes.rows[0];
      if (!patient) throw new Error("PATIENT_NOT_FOUND");

      // Verify routed pharmacy belongs to the doctor's ACTIVE hospital and is ACTIVE
      let verifiedPharmacyId: string | null = null;
      let pharmacyName: string | null = null;
      if (data.pharmacyId) {
        const pharmRes = await client.query<{ id: string; name: string }>(
          "SELECT id, name FROM pharmacies WHERE id = $1 AND hospital_id = $2 AND status = 'ACTIVE' LIMIT 1",
          [data.pharmacyId, hospitalId]
        );
        if (!pharmRes.rowCount) {
          throw new Error("INVALID_PHARMACY");
        }
        verifiedPharmacyId = pharmRes.rows[0].id;
        pharmacyName = pharmRes.rows[0].name;
      }

      const initialStatus =
        data.routeImmediately && verifiedPharmacyId ? "SENT_TO_PHARMACY" : "ISSUED";

      const rxRes = await client.query<{ id: string }>(
        `INSERT INTO prescriptions (
           prescription_number, patient_id, doctor_user_id, hospital_id, pharmacy_id,
           verification_method, status, clinical_notes, issued_at, routed_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)
         RETURNING id`,
        [
          rxNumber,
          patient.id,
          auth.ctx.userId,
          hospitalId,
          verifiedPharmacyId,
          data.verificationMethod,
          initialStatus,
          data.clinicalNotes ? sanitizeText(data.clinicalNotes, 1000) : null,
          initialStatus === "SENT_TO_PHARMACY" ? new Date().toISOString() : null,
        ]
      );
      const rxId = rxRes.rows[0].id;

      for (const item of data.items) {
        await client.query(
          `INSERT INTO prescription_items (
             prescription_id, medicine_id, medicine_name, generic_name, strength,
             dosage_form, dose, route, frequency, duration, quantity, refills, instructions
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            rxId,
            item.medicineId || null,
            sanitizeText(item.medicineName, 140),
            item.genericName ? sanitizeText(item.genericName, 140) : null,
            sanitizeText(item.strength, 60),
            sanitizeText(item.dosageForm, 60),
            sanitizeText(item.dose, 80),
            sanitizeText(item.route, 60),
            sanitizeText(item.frequency, 100),
            sanitizeText(item.duration, 60),
            item.quantity,
            item.refills,
            item.instructions ? sanitizeText(item.instructions, 300) : null,
          ]
        );
      }

      // Notify patient (zero PHI in notification body)
      await client.query(
        `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
         VALUES ($1, $2, 'PRESCRIPTION', 'New Prescription Issued', $3, '/patient')`,
        [
          patient.user_id,
          hospitalId,
          pharmacyName
            ? `Prescription ${rxNumber} has been issued and sent to ${pharmacyName}. Sign in to view details.`
            : `Prescription ${rxNumber} has been issued. Sign in to view details.`,
        ]
      );

      // Notify approved pharmacists at the routed pharmacy
      if (verifiedPharmacyId) {
        const pharmacists = await client.query<{ user_id: string }>(
          `SELECT user_id FROM hospital_memberships
           WHERE hospital_id = $1 AND pharmacy_id = $2 AND role = 'PHARMACIST' AND verification_status = 'APPROVED'`,
          [hospitalId, verifiedPharmacyId]
        );
        for (const ph of pharmacists.rows) {
          await client.query(
            `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
             VALUES ($1, $2, 'PHARMACY_INBOX', 'New Routed Prescription', $3, '/pharmacist')`,
            [
              ph.user_id,
              hospitalId,
              `Prescription ${rxNumber} has been routed to ${pharmacyName} for availability confirmation.`,
            ]
          );
        }
      }

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId,
          action: "PRESCRIPTION_CREATED",
          resourceType: "PRESCRIPTION",
          resourceId: rxNumber,
          outcome: "SUCCESS",
          ipAddress: ip,
          metadata: {
            status: initialStatus,
            pharmacyId: verifiedPharmacyId,
            itemCount: data.items.length,
            verificationMethod: data.verificationMethod,
          },
        },
        client
      );

      return { id: rxId, prescriptionNumber: rxNumber, status: initialStatus };
    });

    return NextResponse.json(
      { message: `Prescription ${created.prescriptionNumber} issued successfully.`, prescription: created },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "PATIENT_NOT_FOUND") {
        return NextResponse.json({ error: "Patient record not found." }, { status: 404 });
      }
      if (err.message === "INVALID_PHARMACY") {
        return NextResponse.json(
          { error: "Selected pharmacy is not an approved pharmacy of your active hospital." },
          { status: 403 }
        );
      }
    }
    return NextResponse.json({ error: "Could not create prescription." }, { status: 500 });
  }
}
