import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, querySystem, withRlsContext } from "@/lib/db";
import { createMedicineSchema } from "@/lib/validators/schemas";
import { sanitizeText } from "@/lib/security/sanitize";
import { recordAuditEvent } from "@/lib/security/audit";

const patchMedicineSchema = z.object({
  id: z.string().uuid(),
  unitPriceCents: z.coerce.number().int().min(0).max(10_000_000).optional(),
  availabilityStatus: z.enum(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"]).optional(),
  isActive: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
  const genericId = req.nextUrl.searchParams.get("genericId")?.trim() || null;
  const hospitalId = req.nextUrl.searchParams.get("hospitalId")?.trim() || null;
  const pharmacyId = req.nextUrl.searchParams.get("pharmacyId")?.trim() || null;
  const availability = req.nextUrl.searchParams.get("availability")?.trim() || null;
  const mine = req.nextUrl.searchParams.get("mine") === "true";

  // If pharmacist requests their own pharmacy catalog management view
  if (mine) {
    const auth = await requireApiAuth(req, {
      roles: ["PHARMACIST", "HOSPITAL_ADMIN"],
      requireActiveHospital: true,
      skipCsrf: true,
    });
    if (!auth.ok) return auth.response;

    const rows = await withRlsContext(auth.ctx.rls, async (client) => {
      const params: unknown[] = [auth.ctx.activeHospitalId];
      let pharmClause = "";
      if (auth.ctx.role === "PHARMACIST" && auth.ctx.activePharmacyId) {
        params.push(auth.ctx.activePharmacyId);
        pharmClause = `AND m.pharmacy_id = $${params.length}`;
      }
      const res = await client.query(
        `SELECT m.*, g.name AS generic_name, g.drug_class,
                h.name AS hospital_name, ph.name AS pharmacy_name, ph.address AS pharmacy_address
         FROM medicines m
         JOIN generics g ON g.id = m.generic_id
         JOIN hospitals h ON h.id = m.hospital_id
         JOIN pharmacies ph ON ph.id = m.pharmacy_id
         WHERE m.hospital_id = $1 ${pharmClause}
         ORDER BY m.display_name ASC`,
        params
      );
      return res.rows;
    });
    return NextResponse.json({ medicines: rows });
  }

  // Public/patient browse of active medicines across active hospitals & pharmacies
  const params: unknown[] = [];
  const conds: string[] = ["m.is_active = TRUE", "h.status = 'ACTIVE'", "ph.status = 'ACTIVE'"];

  if (q) {
    params.push(`%${q}%`);
    conds.push(
      `(LOWER(m.display_name) LIKE $${params.length} OR LOWER(g.name) LIKE $${params.length} OR LOWER(COALESCE(m.manufacturer,'')) LIKE $${params.length})`
    );
  }
  if (genericId && /^[0-9a-f-]{36}$/i.test(genericId)) {
    params.push(genericId);
    conds.push(`m.generic_id = $${params.length}`);
  }
  if (hospitalId && /^[0-9a-f-]{36}$/i.test(hospitalId)) {
    params.push(hospitalId);
    conds.push(`m.hospital_id = $${params.length}`);
  }
  if (pharmacyId && /^[0-9a-f-]{36}$/i.test(pharmacyId)) {
    params.push(pharmacyId);
    conds.push(`m.pharmacy_id = $${params.length}`);
  }
  if (availability && ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"].includes(availability)) {
    params.push(availability);
    conds.push(`m.availability_status = $${params.length}`);
  }

  const res = await querySystem(
    `SELECT m.id, m.display_name, m.strength, m.dosage_form, m.manufacturer, m.pack_size,
            m.unit_price_cents, m.currency, m.availability_status, m.image_upload_id,
            g.id AS generic_id, g.name AS generic_name, g.drug_class,
            h.id AS hospital_id, h.name AS hospital_name,
            ph.id AS pharmacy_id, ph.name AS pharmacy_name, ph.address AS pharmacy_address
     FROM medicines m
     JOIN generics g ON g.id = m.generic_id
     JOIN hospitals h ON h.id = m.hospital_id
     JOIN pharmacies ph ON ph.id = m.pharmacy_id
     WHERE ${conds.join(" AND ")}
     ORDER BY m.display_name ASC
     LIMIT 120`,
    params
  );

  return NextResponse.json({ medicines: res.rows });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["PHARMACIST"],
    requireActiveHospital: true,
    requireActivePharmacy: true,
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = createMedicineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid medicine details." },
      { status: 400 }
    );
  }

  const d = parsed.data;
  try {
    const created = await withRlsContext(auth.ctx.rls, async (client) => {
      const res = await client.query(
        `INSERT INTO medicines (
           hospital_id, pharmacy_id, generic_id, display_name, strength, dosage_form,
           manufacturer, pack_size, sku, unit_price_cents, currency, availability_status,
           image_upload_id, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'BDT',$11,$12,$13)
         RETURNING id, display_name`,
        [
          auth.ctx.activeHospitalId,
          auth.ctx.activePharmacyId,
          d.genericId,
          sanitizeText(d.displayName, 140),
          sanitizeText(d.strength, 60),
          sanitizeText(d.dosageForm, 60),
          d.manufacturer ? sanitizeText(d.manufacturer, 120) : null,
          d.packSize ? sanitizeText(d.packSize, 80) : null,
          d.sku ? sanitizeText(d.sku, 60) : null,
          d.unitPriceCents,
          d.availabilityStatus,
          d.imageUploadId || null,
          auth.ctx.userId,
        ]
      );

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId: auth.ctx.activeHospitalId,
          action: "CATALOG_MEDICINE_CREATED",
          resourceType: "MEDICINE",
          resourceId: res.rows[0].id,
          outcome: "SUCCESS",
          ipAddress: getClientIp(req.headers),
        },
        client
      );
      return res.rows[0];
    });
    return NextResponse.json({ message: "Medicine added to pharmacy catalog.", medicine: created }, { status: 201 });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return NextResponse.json(
        { error: "This medicine with the same strength and dosage form already exists in your pharmacy catalog." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Could not add medicine." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["PHARMACIST"],
    requireActiveHospital: true,
    requireActivePharmacy: true,
  });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = patchMedicineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update payload." }, { status: 400 });
  }

  const updated = await withRlsContext(auth.ctx.rls, async (client) => {
    const res = await client.query(
      `UPDATE medicines
       SET unit_price_cents = COALESCE($1, unit_price_cents),
           availability_status = COALESCE($2, availability_status),
           is_active = COALESCE($3, is_active),
           updated_at = NOW()
       WHERE id = $4 AND hospital_id = $5 AND pharmacy_id = $6
       RETURNING id, display_name, availability_status, unit_price_cents`,
      [
        parsed.data.unitPriceCents ?? null,
        parsed.data.availabilityStatus ?? null,
        parsed.data.isActive ?? null,
        parsed.data.id,
        auth.ctx.activeHospitalId,
        auth.ctx.activePharmacyId,
      ]
    );
    return res.rows[0] ?? null;
  });

  if (!updated) {
    return NextResponse.json(
      { error: "Medicine not found in your active pharmacy catalog." },
      { status: 404 }
    );
  }

  return NextResponse.json({ message: "Catalog item updated.", medicine: updated });
}
