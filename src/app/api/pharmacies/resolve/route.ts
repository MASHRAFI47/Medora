import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { withRlsContext } from "@/lib/db";

/**
 * Resolves eligible approved pharmacies associated with the doctor's active hospital.
 * Even when searching by a pharmacist's username or phone, ALWAYS resolves to and confirms
 * the approved pharmacy entity so clinical data is never routed to an unverified personal account.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["DOCTOR", "HOSPITAL_ADMIN", "PHARMACIST"],
    requireActiveHospital: true,
    skipCsrf: true,
  });
  if (!auth.ok) return auth.response;

  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  const pharmacies = await withRlsContext(auth.ctx.rls, async (client) => {
    const res = await client.query(
      `SELECT DISTINCT ph.id, ph.name, ph.code, ph.address, ph.phone, ph.pickup_instructions,
              h.name AS hospital_name,
              COALESCE(
                (SELECT json_agg(json_build_object('fullName', u.full_name, 'username', u.username))
                 FROM hospital_memberships hm2
                 JOIN users u ON u.id = hm2.user_id
                 WHERE hm2.pharmacy_id = ph.id AND hm2.role = 'PHARMACIST' AND hm2.verification_status = 'APPROVED'),
                '[]'::json
              ) AS approved_pharmacists
       FROM pharmacies ph
       JOIN hospitals h ON h.id = ph.hospital_id
       LEFT JOIN hospital_memberships hm ON hm.pharmacy_id = ph.id AND hm.verification_status = 'APPROVED'
       LEFT JOIN users u ON u.id = hm.user_id
       WHERE ph.hospital_id = $1
         AND ph.status = 'ACTIVE'
         AND (
           $2 = ''
           OR LOWER(ph.name) LIKE '%' || $2 || '%'
           OR LOWER(ph.code) LIKE '%' || $2 || '%'
           OR LOWER(COALESCE(u.username, '')) = $2
           OR COALESCE(u.phone, '') = $2
         )
       ORDER BY ph.name ASC`,
      [auth.ctx.activeHospitalId, q]
    );
    return res.rows;
  });

  return NextResponse.json({ pharmacies });
}
