import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, querySystem } from "@/lib/db";
import { createGenericSchema } from "@/lib/validators/schemas";
import { normalizeGenericName, sanitizeText } from "@/lib/security/sanitize";
import { recordAuditEvent } from "@/lib/security/audit";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  const res = await querySystem(
    `SELECT g.id, g.name, g.drug_class, g.description, g.common_strengths, g.status,
            COUNT(m.id) FILTER (WHERE m.is_active = TRUE)::int AS medicine_count
     FROM generics g
     LEFT JOIN medicines m ON m.generic_id = g.id
     WHERE g.status = 'ACTIVE'
       AND ($1 = '' OR LOWER(g.name) LIKE '%' || $1 || '%' OR LOWER(COALESCE(g.drug_class,'')) LIKE '%' || $1 || '%')
     GROUP BY g.id
     ORDER BY g.name ASC
     LIMIT 120`,
    [q]
  );

  return NextResponse.json({ generics: res.rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["PHARMACIST", "HOSPITAL_ADMIN", "PLATFORM_ADMIN"],
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createGenericSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid generic details." },
      { status: 400 }
    );
  }

  const name = sanitizeText(parsed.data.name, 140);
  const normalized = normalizeGenericName(name);

  try {
    const res = await querySystem(
      `INSERT INTO generics (name, normalized_name, drug_class, description, common_strengths, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
       RETURNING id, name`,
      [
        name,
        normalized,
        parsed.data.drugClass ? sanitizeText(parsed.data.drugClass, 120) : null,
        parsed.data.description ? sanitizeText(parsed.data.description, 600) : null,
        parsed.data.commonStrengths ? sanitizeText(parsed.data.commonStrengths, 200) : null,
        auth.ctx.userId,
      ]
    );

    await recordAuditEvent({
      actorUserId: auth.ctx.userId,
      actorRole: auth.ctx.role,
      hospitalId: auth.ctx.activeHospitalId,
      action: "GENERIC_CREATED",
      resourceType: "GENERIC",
      resourceId: res.rows[0].id,
      outcome: "SUCCESS",
      ipAddress: getClientIp(req.headers),
    });

    return NextResponse.json({ message: "Generic entry created.", generic: res.rows[0] }, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === "23505") {
      return NextResponse.json(
        { error: "A generic with this normalized active-ingredient name already exists." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not create generic." }, { status: 500 });
  }
}
