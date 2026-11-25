import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, querySystem } from "@/lib/db";
import { recordAuditEvent } from "@/lib/security/audit";

const switchContextSchema = z.object({
  hospitalId: z.string().uuid(),
  pharmacyId: z.string().uuid().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { skipCsrf: true });
  if (!auth.ok) return auth.response;

  const memberships = await querySystem<{
    id: string;
    hospital_id: string;
    hospital_name: string;
    hospital_status: string;
    pharmacy_id: string | null;
    pharmacy_name: string | null;
    role: string;
    verification_status: string;
    license_number: string | null;
  }>(
    `SELECT hm.id, hm.hospital_id, h.name AS hospital_name, h.status AS hospital_status,
            hm.pharmacy_id, p.name AS pharmacy_name, hm.role, hm.verification_status, hm.license_number
     FROM hospital_memberships hm
     JOIN hospitals h ON h.id = hm.hospital_id
     LEFT JOIN pharmacies p ON p.id = hm.pharmacy_id
     WHERE hm.user_id = $1
     ORDER BY h.name ASC`,
    [auth.ctx.userId]
  );

  return NextResponse.json({
    user: {
      id: auth.ctx.userId,
      username: auth.ctx.username,
      fullName: auth.ctx.fullName,
      role: auth.ctx.role,
      accountStatus: auth.ctx.accountStatus,
      activeHospitalId: auth.ctx.activeHospitalId,
      activePharmacyId: auth.ctx.activePharmacyId,
      mfaEnabled: auth.ctx.mfaEnabled,
      mustChangePassword: auth.ctx.mustChangePassword,
    },
    memberships: memberships.rows,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["HOSPITAL_ADMIN", "DOCTOR", "PHARMACIST"],
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = switchContextSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid organization context." }, { status: 400 });
  }

  const mem = await querySystem<{
    hospital_id: string;
    pharmacy_id: string | null;
    verification_status: string;
    hospital_status: string;
  }>(
    `SELECT hm.hospital_id, hm.pharmacy_id, hm.verification_status, h.status AS hospital_status
     FROM hospital_memberships hm
     JOIN hospitals h ON h.id = hm.hospital_id
     WHERE hm.user_id = $1 AND hm.hospital_id = $2 AND hm.role = $3
     LIMIT 1`,
    [auth.ctx.userId, parsed.data.hospitalId, auth.ctx.role]
  );

  const row = mem.rows[0];
  if (!row || row.verification_status !== "APPROVED" || row.hospital_status !== "ACTIVE") {
    return NextResponse.json(
      { error: "You do not have an approved membership in this active hospital." },
      { status: 403 }
    );
  }

  const nextPharmacyId =
    auth.ctx.role === "PHARMACIST" ? row.pharmacy_id : parsed.data.pharmacyId ?? null;

  await querySystem(
    "UPDATE users SET active_hospital_id = $1, active_pharmacy_id = $2, updated_at = NOW() WHERE id = $3",
    [row.hospital_id, nextPharmacyId, auth.ctx.userId]
  );

  await recordAuditEvent({
    actorUserId: auth.ctx.userId,
    actorRole: auth.ctx.role,
    hospitalId: row.hospital_id,
    action: "ACTIVE_HOSPITAL_CONTEXT_SWITCHED",
    resourceType: "HOSPITAL",
    resourceId: row.hospital_id,
    outcome: "SUCCESS",
    ipAddress: getClientIp(req.headers),
  });

  return NextResponse.json({
    message: "Active organization context updated.",
    activeHospitalId: row.hospital_id,
    activePharmacyId: nextPharmacyId,
  });
}
