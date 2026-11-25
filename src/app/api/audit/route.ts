import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { withRlsContext } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["PLATFORM_ADMIN", "HOSPITAL_ADMIN"],
    skipCsrf: true,
  });
  if (!auth.ok) return auth.response;

  if (auth.ctx.role === "HOSPITAL_ADMIN" && !auth.ctx.activeHospitalId) {
    return NextResponse.json({ error: "Active hospital context required." }, { status: 403 });
  }

  const logs = await withRlsContext(auth.ctx.rls, async (client) => {
    const params: unknown[] = [];
    let where = "";
    if (auth.ctx.role === "HOSPITAL_ADMIN") {
      params.push(auth.ctx.activeHospitalId);
      where = "WHERE a.hospital_id = $1";
    }
    const res = await client.query(
      `SELECT a.id, a.actor_role, a.action, a.resource_type, a.resource_id,
              a.outcome, a.ip_address, a.metadata, a.prev_hash, a.event_hash, a.created_at,
              u.username AS actor_username, h.name AS hospital_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       LEFT JOIN hospitals h ON h.id = a.hospital_id
       ${where}
       ORDER BY a.id DESC
       LIMIT 100`,
      params
    );
    return res.rows;
  });

  return NextResponse.json({ logs });
}
