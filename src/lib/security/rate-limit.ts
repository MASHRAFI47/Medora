import "server-only";
import { getPool } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const memoryFallback = new Map<string, { count: number; resetAt: number }>();

/**
 * PostgreSQL-backed rate limiter with automatic in-memory fallback.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const pool = getPool();
    const res = await pool.query<{ count: number; retry_after: number }>(
      `INSERT INTO rate_limits (key, count, window_reset_at)
       VALUES ($1, 1, NOW() + ($2 || ' seconds')::interval)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE
           WHEN rate_limits.window_reset_at <= NOW() THEN 1
           ELSE rate_limits.count + 1
         END,
         window_reset_at = CASE
           WHEN rate_limits.window_reset_at <= NOW() THEN NOW() + ($2 || ' seconds')::interval
           ELSE rate_limits.window_reset_at
         END
       RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_reset_at - NOW()))))::int AS retry_after`,
      [key, String(windowSeconds)]
    );
    const row = res.rows[0];
    const allowed = row.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - row.count),
      retryAfterSeconds: allowed ? 0 : row.retry_after,
    };
  } catch {
    // Fallback to in-memory window if DB is temporarily unreachable
    const now = Date.now();
    const existing = memoryFallback.get(key);
    if (!existing || existing.resetAt <= now) {
      memoryFallback.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }
    existing.count += 1;
    const allowed = existing.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
}
