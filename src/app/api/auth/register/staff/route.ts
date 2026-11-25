import { NextRequest, NextResponse } from "next/server";
import { getClientIp, withRlsContext } from "@/lib/db";
import { staffRegisterSchema } from "@/lib/validators/schemas";
import { hashSecret, validateStrongPassword } from "@/lib/security/crypto";
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
  const rl = await checkRateLimit(`register:staff:${ip}`, 8, 900);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = staffRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid staff registration details." },
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
  const passwordHash = hashSecret(parsed.data.password);

  try {
    const result = await withRlsContext({ bypassRls: true }, async (client) => {
      const hospCheck = await client.query(
        "SELECT id, name FROM hospitals WHERE id = $1 AND status = 'ACTIVE' LIMIT 1",
        [parsed.data.hospitalId]
      );
      if (!hospCheck.rowCount) {
        throw new Error("INVALID_HOSPITAL");
      }

      let validPharmacyId: string | null = null;
      if (parsed.data.pharmacyId) {
        const pharmCheck = await client.query(
          "SELECT id FROM pharmacies WHERE id = $1 AND hospital_id = $2 AND status = 'ACTIVE' LIMIT 1",
          [parsed.data.pharmacyId, parsed.data.hospitalId]
        );
        if (!pharmCheck.rowCount) {
          throw new Error("INVALID_PHARMACY");
        }
        validPharmacyId = pharmCheck.rows[0].id;
      }

      const existing = await client.query(
        "SELECT id FROM users WHERE LOWER(email) = $1 OR LOWER(username) = $2 LIMIT 1",
        [email, username]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        throw new Error("CONFLICT");
      }

      // Account created with PENDING_APPROVAL membership; privileged actions remain blocked until Hospital Admin approves
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO users (email, username, phone, phone_verified, full_name, password_hash, primary_role, account_status)
         VALUES ($1, $2, $3, TRUE, $4, $5, $6, 'PENDING_APPROVAL')
         RETURNING id`,
        [email, username, phone, fullName, passwordHash, parsed.data.role]
      );
      const userId = userRes.rows[0].id;

      await client.query(
        `INSERT INTO hospital_memberships (
           user_id, hospital_id, pharmacy_id, role, verification_status,
           license_number, issuing_jurisdiction, specialty, credentials, workplace_affiliation
         ) VALUES ($1,$2,$3,$4,'PENDING',$5,$6,$7,$8,$9)`,
        [
          userId,
          parsed.data.hospitalId,
          validPharmacyId,
          parsed.data.role,
          sanitizeText(parsed.data.licenseNumber, 80),
          sanitizeText(parsed.data.issuingJurisdiction, 80),
          parsed.data.specialty ? sanitizeText(parsed.data.specialty, 120) : null,
          parsed.data.credentials ? sanitizeText(parsed.data.credentials, 120) : null,
          parsed.data.workplaceAffiliation
            ? sanitizeText(parsed.data.workplaceAffiliation, 160)
            : null,
        ]
      );

      // Notify hospital administrators of the requested hospital only (tenant-scoped)
      const admins = await client.query<{ user_id: string }>(
        `SELECT user_id FROM hospital_memberships
         WHERE hospital_id = $1 AND role = 'HOSPITAL_ADMIN' AND verification_status = 'APPROVED'`,
        [parsed.data.hospitalId]
      );
      for (const admin of admins.rows) {
        await client.query(
          `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
           VALUES ($1, $2, 'STAFF_APPROVAL', 'New Staff Verification Request', $3, '/admin/hospital')`,
          [
            admin.user_id,
            parsed.data.hospitalId,
            `${fullName} requested ${parsed.data.role} access. Review license details in your Hospital Admin console.`,
          ]
        );
      }

      await recordAuditEvent(
        {
          actorUserId: userId,
          actorRole: parsed.data.role,
          hospitalId: parsed.data.hospitalId,
          action: "STAFF_REGISTRATION_REQUESTED",
          resourceType: "HOSPITAL_MEMBERSHIP",
          resourceId: userId,
          outcome: "SUCCESS",
          ipAddress: ip,
          metadata: { requestedRole: parsed.data.role },
        },
        client
      );

      return { hospitalName: hospCheck.rows[0].name };
    });

    return NextResponse.json(
      {
        message: `Staff verification request submitted for ${result.hospitalName}. Privileged clinical and pharmacy features remain locked until a hospital administrator verifies your license and approves your membership.`,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "CONFLICT") {
        return NextResponse.json(
          { error: "An account with this email or username already exists." },
          { status: 409 }
        );
      }
      if (err.message === "INVALID_HOSPITAL" || err.message === "INVALID_PHARMACY") {
        return NextResponse.json(
          { error: "Selected hospital or pharmacy is invalid or inactive." },
          { status: 400 }
        );
      }
    }
    return NextResponse.json({ error: "Staff registration failed." }, { status: 500 });
  }
}
