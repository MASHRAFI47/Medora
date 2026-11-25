import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, querySystem, withRlsContext } from "@/lib/db";
import { createHospitalSchema } from "@/lib/validators/schemas";
import { sanitizeText } from "@/lib/security/sanitize";
import { recordAuditEvent } from "@/lib/security/audit";

const patchHospitalSchema = z.object({
  hospitalId: z.string().uuid(),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

export async function GET(req: NextRequest) {
  const includeAll = req.nextUrl.searchParams.get("all") === "true";

  if (includeAll) {
    const auth = await requireApiAuth(req, {
      roles: ["PLATFORM_ADMIN"],
      skipCsrf: true,
    });
    if (!auth.ok) return auth.response;

    const res = await withRlsContext(auth.ctx.rls, async (client) => {
      return client.query(
        `SELECT h.*,
                (SELECT COUNT(*)::int FROM pharmacies ph WHERE ph.hospital_id = h.id) AS pharmacy_count,
                (SELECT COUNT(*)::int FROM hospital_memberships hm WHERE hm.hospital_id = h.id AND hm.verification_status = 'APPROVED') AS approved_staff_count,
                (SELECT COUNT(*)::int FROM prescriptions rx WHERE rx.hospital_id = h.id) AS prescription_count
         FROM hospitals h
         ORDER BY h.created_at DESC`
      );
    });
    return NextResponse.json({ hospitals: res.rows });
  }

  // Public list of active hospitals and their active pharmacies (for registration & browsing)
  const res = await querySystem(
    `SELECT h.id, h.name, h.slug, h.registration_code, h.address, h.phone,
            COALESCE(
              (SELECT json_agg(json_build_object('id', ph.id, 'name', ph.name, 'code', ph.code, 'address', ph.address) ORDER BY ph.name ASC)
               FROM pharmacies ph WHERE ph.hospital_id = h.id AND ph.status = 'ACTIVE'),
              '[]'::json
            ) AS pharmacies
     FROM hospitals h
     WHERE h.status = 'ACTIVE'
     ORDER BY h.name ASC`
  );
  return NextResponse.json({ hospitals: res.rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { roles: ["PLATFORM_ADMIN"] });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createHospitalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid hospital tenant details." },
      { status: 400 }
    );
  }

  const d = parsed.data;
  try {
    const created = await withRlsContext(auth.ctx.rls, async (client) => {
      const res = await client.query(
        `INSERT INTO hospitals (name, slug, registration_code, address, phone, email, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7)
         RETURNING id, name, slug, registration_code`,
        [
          sanitizeText(d.name, 140),
          d.slug.toLowerCase(),
          sanitizeText(d.registrationCode, 50).toUpperCase(),
          d.address ? sanitizeText(d.address, 240) : null,
          d.phone ? sanitizeText(d.phone, 30) : null,
          d.email ? d.email.toLowerCase() : null,
          auth.ctx.userId,
        ]
      );

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId: res.rows[0].id,
          action: "HOSPITAL_TENANT_CREATED",
          resourceType: "HOSPITAL",
          resourceId: res.rows[0].id,
          outcome: "SUCCESS",
          ipAddress: getClientIp(req.headers),
        },
        client
      );
      return res.rows[0];
    });
    return NextResponse.json({ message: "Hospital tenant created.", hospital: created }, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json(
        { error: "A hospital with that slug or registration code already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not create hospital tenant." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiAuth(req, { roles: ["PLATFORM_ADMIN"] });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = patchHospitalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid hospital status update." }, { status: 400 });
  }

  await withRlsContext(auth.ctx.rls, async (client) => {
    await client.query(
      "UPDATE hospitals SET status = $1, updated_at = NOW() WHERE id = $2",
      [parsed.data.status, parsed.data.hospitalId]
    );
    await recordAuditEvent(
      {
        actorUserId: auth.ctx.userId,
        actorRole: auth.ctx.role,
        hospitalId: parsed.data.hospitalId,
        action: `HOSPITAL_TENANT_${parsed.data.status}`,
        resourceType: "HOSPITAL",
        resourceId: parsed.data.hospitalId,
        outcome: "SUCCESS",
        ipAddress: getClientIp(req.headers),
      },
      client
    );
  });

  return NextResponse.json({ message: `Hospital tenant marked ${parsed.data.status}.` });
}
