import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import { validateAndSaveUpload } from "@/lib/security/upload";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { recordAuditEvent } from "@/lib/security/audit";

const VALID_PURPOSES = new Set([
  "CATALOG_IMAGE",
  "LICENSE_DOCUMENT",
  "PRESCRIPTION_ATTACHMENT",
]);

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, {
    roles: ["DOCTOR", "PHARMACIST", "HOSPITAL_ADMIN", "PLATFORM_ADMIN"],
  });
  if (!auth.ok) return auth.response;

  const rl = await checkRateLimit(`upload:${auth.ctx.userId}`, 15, 600);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Upload rate limit reached." }, { status: 429 });
  }

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const file = formData.get("file");
  const purpose = String(formData.get("purpose") || "CATALOG_IMAGE");
  if (!VALID_PURPOSES.has(purpose)) {
    return NextResponse.json({ error: "Invalid upload purpose." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field." }, { status: 400 });
  }

  try {
    const saved = await validateAndSaveUpload(file);

    const record = await withRlsContext(auth.ctx.rls, async (client) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO uploaded_files (
           uploaded_by, hospital_id, purpose, original_filename,
           stored_filename, mime_type, size_bytes, sha256_hex
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          auth.ctx.userId,
          auth.ctx.activeHospitalId,
          purpose,
          saved.originalFilename,
          saved.storedFilename,
          saved.mimeType,
          saved.sizeBytes,
          saved.sha256Hex,
        ]
      );

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId: auth.ctx.activeHospitalId,
          action: "FILE_UPLOADED",
          resourceType: "UPLOADED_FILE",
          resourceId: res.rows[0].id,
          outcome: "SUCCESS",
          ipAddress: getClientIp(req.headers),
          metadata: { purpose, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes },
        },
        client
      );
      return res.rows[0];
    });

    return NextResponse.json(
      {
        uploadId: record.id,
        url: `/api/uploads/${record.id}`,
        mimeType: saved.mimeType,
        sizeBytes: saved.sizeBytes,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "File validation failed." },
      { status: 400 }
    );
  }
}
