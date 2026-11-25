import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { withRlsContext } from "@/lib/db";

const markReadSchema = z.object({
  notificationId: z.string().uuid().optional(),
  markAll: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { skipCsrf: true });
  if (!auth.ok) return auth.response;

  const notifications = await withRlsContext(auth.ctx.rls, async (client) => {
    const res = await client.query(
      `SELECT id, category, title, body, action_url, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [auth.ctx.userId]
    );
    return res.rows;
  });

  return NextResponse.json({ notifications });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireApiAuth(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = markReadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid notification update." }, { status: 400 });
  }

  await withRlsContext(auth.ctx.rls, async (client) => {
    if (parsed.data.markAll) {
      await client.query(
        "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
        [auth.ctx.userId]
      );
    } else if (parsed.data.notificationId) {
      await client.query(
        "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2",
        [parsed.data.notificationId, auth.ctx.userId]
      );
    }
  });

  return NextResponse.json({ message: "Notifications updated." });
}
