import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { withRlsContext } from "@/lib/db";
import { getPrivateUploadDir } from "@/lib/security/upload";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, { skipCsrf: true });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid file ID." }, { status: 400 });
  }

  const meta = await withRlsContext(auth.ctx.rls, async (client) => {
    const res = await client.query<{
      stored_filename: string;
      original_filename: string;
      mime_type: string;
    }>(
      "SELECT stored_filename, original_filename, mime_type FROM uploaded_files WHERE id = $1 LIMIT 1",
      [id]
    );
    return res.rows[0] ?? null;
  });

  if (!meta) {
    return NextResponse.json({ error: "File not found or access denied." }, { status: 404 });
  }

  const uploadDir = path.resolve(getPrivateUploadDir());
  const filePath = path.resolve(uploadDir, path.basename(meta.stored_filename));
  if (!filePath.startsWith(uploadDir + path.sep)) {
    return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
  }

  try {
    const buffer = await fs.readFile(filePath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": meta.mime_type,
        "Content-Disposition": `attachment; filename="${meta.original_filename.replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Stored file missing." }, { status: 404 });
  }
}
