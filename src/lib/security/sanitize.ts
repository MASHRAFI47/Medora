/**
 * Input sanitization helpers to defend against XSS and injection payloads.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/javascript:/gi, "")
    .replace(/on\w+\s*=/gi, "");
}

export function sanitizeText(input: string, maxLen = 500): string {
  return stripHtml(input)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

export function normalizePhone(raw: string): string {
  const cleaned = raw.trim().replace(/[^\d+]/g, "");
  return cleaned.slice(0, 20);
}

export function normalizeGenericName(raw: string): string {
  return sanitizeText(raw, 160)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
