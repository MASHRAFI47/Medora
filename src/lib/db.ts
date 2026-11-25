import "server-only";
import pg, { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { serverEnv } from "@/lib/env";

declare global {
  var __medoraPgPool: Pool | undefined;
}

export function getPool(): Pool {
  if (!globalThis.__medoraPgPool) {
    globalThis.__medoraPgPool = new pg.Pool({
      connectionString: serverEnv.databaseUrl,
      max: 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalThis.__medoraPgPool;
}

export interface RlsContext {
  userId?: string | null;
  userRole?: string | null;
  hospitalId?: string | null;
  pharmacyId?: string | null;
  bypassRls?: boolean;
}

/**
 * Executes a callback inside a PostgreSQL transaction with transaction-local
 * Row Level Security (RLS) session variables set via `set_config(..., true)`.
 */
export async function withRlsContext<T>(
  ctx: RlsContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT
        set_config('app.user_id', $1, true),
        set_config('app.user_role', $2, true),
        set_config('app.hospital_id', $3, true),
        set_config('app.pharmacy_id', $4, true),
        set_config('app.bypass_rls', $5, true)`,
      [
        ctx.userId ?? "",
        ctx.userRole ?? "",
        ctx.hospitalId ?? "",
        ctx.pharmacyId ?? "",
        ctx.bypassRls ? "true" : "false",
      ]
    );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function querySystem<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<QueryResult<T>> {
  return withRlsContext({ bypassRls: true }, (client) => client.query<T>(text, params));
}

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim().slice(0, 64);
  }
  return (headers.get("x-real-ip") || "127.0.0.1").trim().slice(0, 64);
}
