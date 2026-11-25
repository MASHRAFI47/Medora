import "server-only";
import { PoolClient } from "pg";
import { withRlsContext } from "@/lib/db";
import { sha256Hex } from "@/lib/security/crypto";
import { redactValue } from "@/lib/security/logger";

export interface AuditInput {
  actorUserId?: string | null;
  actorRole?: string | null;
  hospitalId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

async function insertAuditWithClient(client: PoolClient, input: AuditInput) {
  // Advisory transaction lock serializes hash-chain head calculation cleanly
  await client.query("SELECT pg_advisory_xact_lock(928374651)");
  const prevRes = await client.query<{ event_hash: string }>(
    "SELECT event_hash FROM audit_logs ORDER BY id DESC LIMIT 1"
  );
  const prevHash = prevRes.rows[0]?.event_hash ?? "GENESIS";

  const safeMetadata = (redactValue(input.metadata ?? {}) as Record<string, unknown>) || {};
  const canonical = JSON.stringify({
    actorUserId: input.actorUserId ?? null,
    actorRole: input.actorRole ?? null,
    hospitalId: input.hospitalId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    outcome: input.outcome,
    metadata: safeMetadata,
  });

  const eventHash = sha256Hex(`${prevHash}|${canonical}`);

  await client.query(
    `INSERT INTO audit_logs (
       actor_user_id, actor_role, hospital_id, action, resource_type,
       resource_id, outcome, ip_address, metadata, prev_hash, event_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
    [
      input.actorUserId ?? null,
      input.actorRole ?? null,
      input.hospitalId ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      input.outcome,
      input.ipAddress ?? null,
      JSON.stringify(safeMetadata),
      prevHash,
      eventHash,
    ]
  );
}

export async function recordAuditEvent(input: AuditInput, existingClient?: PoolClient): Promise<void> {
  if (existingClient) {
    await insertAuditWithClient(existingClient, input);
    return;
  }
  await withRlsContext({ bypassRls: true }, async (client) => {
    await insertAuditWithClient(client, input);
  });
}
