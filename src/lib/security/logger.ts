import "server-only";

const SENSITIVE_KEY_PATTERN =
  /pass|secret|token|otp|generator|totp|mfa|cookie|auth|credential|clinical|allerg|dob|birth|phone|email|address|diagnosis|note|card|cvv|key/i;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[REDACTED_DEPTH]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 180) return `${value.slice(0, 60)}...[TRUNCATED]`;
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

type LogLevel = "info" | "warn" | "error";

function writeLog(level: LogLevel, event: string, context?: Record<string, unknown>) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    service: "medora",
    event,
    ...(context ? { context: redactValue(context) } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export const logger = {
  info: (event: string, context?: Record<string, unknown>) => writeLog("info", event, context),
  warn: (event: string, context?: Record<string, unknown>) => writeLog("warn", event, context),
  error: (event: string, context?: Record<string, unknown>) => writeLog("error", event, context),
};
