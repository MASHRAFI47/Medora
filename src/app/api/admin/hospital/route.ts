import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import { createPharmacySchema } from "@/lib/validators/schemas";
import { sanitizeText } from "@/lib/security/sanitize";
import { recordAuditEvent } from "@/lib/security/audit";

const reviewMembershipSchema = z.object({
  membershipId: z.string().uuid(),
  verificationStatus: z.enum(["APPROVED", "REJECTED", "SUSPENDED"]),
  pharmacyId: z.string().uuid().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["HOSPITAL_ADMIN"],
    requireActiveHospital: true,
    skipCsrf: true,
  });
  if (!auth.ok) return auth.response;

  const hospitalId = auth.ctx.activeHospitalId!;

  const data = await withRlsContext(auth.ctx.rls, async (client) => {
    const hospitalRes = await client.query(
      "SELECT * FROM hospitals WHERE id = $1 LIMIT 1",
      [hospitalId]
    );
    const pharmaciesRes = await client.query(
      "SELECT * FROM pharmacies WHERE hospital_id = $1 ORDER BY name ASC",
      [hospitalId]
    );
    const staffRes = await client.query(
      `SELECT hm.id, hm.user_id, hm.role, hm.verification_status, hm.pharmacy_id,
              hm.license_number, hm.issuing_jurisdiction, hm.specialty, hm.credentials,
              hm.workplace_affiliation, hm.approved_at, hm.created_at,
              u.full_name, u.username, u.email, u.phone, u.account_status,
              ph.name AS pharmacy_name
       FROM hospital_memberships hm
       JOIN users u ON u.id = hm.user_id
       LEFT JOIN pharmacies ph ON ph.id = hm.pharmacy_id
       WHERE hm.hospital_id = $1
       ORDER BY
         CASE hm.verification_status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END,
         hm.created_at DESC`,
      [hospitalId]
    );
    return {
      hospital: hospitalRes.rows[0] ?? null,
      pharmacies: pharmaciesRes.rows,
      memberships: staffRes.rows,
    };
  });

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["HOSPITAL_ADMIN"],
    requireActiveHospital: true,
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createPharmacySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid pharmacy details." },
      { status: 400 }
    );
  }

  const d = parsed.data;
  try {
    const created = await withRlsContext(auth.ctx.rls, async (client) => {
      const res = await client.query(
        `INSERT INTO pharmacies (hospital_id, name, code, address, phone, pickup_instructions, status)
         VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE')
         RETURNING *`,
        [
          auth.ctx.activeHospitalId,
          sanitizeText(d.name, 140),
          sanitizeText(d.code, 40).toUpperCase(),
          d.address ? sanitizeText(d.address, 240) : null,
          d.phone ? sanitizeText(d.phone, 30) : null,
          d.pickupInstructions ? sanitizeText(d.pickupInstructions, 400) : null,
        ]
      );

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId: auth.ctx.activeHospitalId,
          action: "PHARMACY_ASSOCIATED",
          resourceType: "PHARMACY",
          resourceId: res.rows[0].id,
          outcome: "SUCCESS",
          ipAddress: getClientIp(req.headers),
        },
        client
      );
      return res.rows[0];
    });
    return NextResponse.json({ message: "Pharmacy added to hospital network.", pharmacy: created }, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json(
        { error: "A pharmacy with that code already exists in this hospital." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not add pharmacy." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["HOSPITAL_ADMIN"],
    requireActiveHospital: true,
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = reviewMembershipSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid membership review request." }, { status: 400 });
  }

  const hospitalId = auth.ctx.activeHospitalId!;
  const ip = getClientIp(req.headers);

  try {
    await withRlsContext(auth.ctx.rls, async (client) => {
      // Strictly verify membership belongs to THIS hospital admin's tenant
      const memRes = await client.query<{
        id: string;
        user_id: string;
        role: string;
        pharmacy_id: string | null;
      }>(
        "SELECT id, user_id, role, pharmacy_id FROM hospital_memberships WHERE id = $1 AND hospital_id = $2 LIMIT 1",
        [parsed.data.membershipId, hospitalId]
      );
      const mem = memRes.rows[0];
      if (!mem) throw new Error("NOT_FOUND");

      let nextPharmacyId = parsed.data.pharmacyId !== undefined ? parsed.data.pharmacyId : mem.pharmacy_id;
      if (nextPharmacyId) {
        const ph = await client.query(
          "SELECT id FROM pharmacies WHERE id = $1 AND hospital_id = $2 LIMIT 1",
          [nextPharmacyId, hospitalId]
        );
        if (!ph.rowCount) throw new Error("INVALID_PHARMACY");
      }

      if (mem.role === "PHARMACIST" && parsed.data.verificationStatus === "APPROVED" && !nextPharmacyId) {
        throw new Error("PHARMACY_REQUIRED");
      }

      await client.query(
        `UPDATE hospital_memberships
         SET verification_status = $1,
             pharmacy_id = $2,
             approved_by = $3,
             approved_at = CASE WHEN $1 = 'APPROVED' THEN NOW() ELSE approved_at END,
             updated_at = NOW()
         WHERE id = $4 AND hospital_id = $5`,
        [
          parsed.data.verificationStatus,
          nextPharmacyId,
          auth.ctx.userId,
          mem.id,
          hospitalId,
        ]
      );

      if (parsed.data.verificationStatus === "APPROVED") {
        await client.query(
          `UPDATE users
           SET account_status = 'ACTIVE',
               active_hospital_id = COALESCE(active_hospital_id, $1),
               active_pharmacy_id = COALESCE(active_pharmacy_id, $2),
               updated_at = NOW()
           WHERE id = $3`,
          [hospitalId, nextPharmacyId, mem.user_id]
        );
      }

      await client.query(
        `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
         VALUES ($1, $2, 'STAFF_STATUS', 'Staff Membership Status Updated', $3, '/dashboard')`,
        [
          mem.user_id,
          hospitalId,
          `Your ${mem.role} membership status has been updated to ${parsed.data.verificationStatus}.`,
        ]
      );

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId,
          action: `STAFF_MEMBERSHIP_${parsed.data.verificationStatus}`,
          resourceType: "HOSPITAL_MEMBERSHIP",
          resourceId: mem.id,
          outcome: "SUCCESS",
          ipAddress: ip,
          metadata: { targetRole: mem.role, pharmacyId: nextPharmacyId },
        },
        client
      );
    });

    return NextResponse.json({
      message: `Staff membership updated to ${parsed.data.verificationStatus}.`,
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Membership not found in your hospital." }, { status: 404 });
      }
      if (err.message === "INVALID_PHARMACY") {
        return NextResponse.json({ error: "Pharmacy does not belong to your hospital." }, { status: 400 });
      }
      if (err.message === "PHARMACY_REQUIRED") {
        return NextResponse.json(
          { error: "Assign an active pharmacy location before approving a pharmacist." },
          { status: 400 }
        );
      }
    }
    return NextResponse.json({ error: "Could not update staff membership." }, { status: 500 });
  }
}
