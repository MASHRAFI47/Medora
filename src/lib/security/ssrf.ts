import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const num = ipv4ToInt(ip);
  const ranges: Array<[number, number]> = [
    [ipv4ToInt("0.0.0.0"), ipv4ToInt("0.255.255.255")],       // "This" network
    [ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],     // RFC1918
    [ipv4ToInt("100.64.0.0"), ipv4ToInt("100.127.255.255")],  // CGNAT
    [ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],   // Loopback
    [ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")], // Link-local / Cloud Metadata
    [ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],   // RFC1918
    [ipv4ToInt("192.0.0.0"), ipv4ToInt("192.0.0.255")],       // IETF protocol
    [ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")], // RFC1918
    [ipv4ToInt("198.18.0.0"), ipv4ToInt("198.19.255.255")],   // Benchmarking
    [ipv4ToInt("224.0.0.0"), ipv4ToInt("255.255.255.255")],   // Multicast & Reserved
  ];
  return ranges.some(([start, end]) => num >= start && num <= end);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // Unique local
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true; // Link-local
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (net.isIPv4(mapped)) return isPrivateIpv4(mapped);
  }
  return false;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true;
}

/**
 * Validates an outbound URL against SSRF vectors:
 * - HTTPS only
 * - No embedded credentials
 * - Optional explicit hostname allowlist
 * - DNS resolution check blocking private, loopback, link-local, and cloud metadata IPs
 */
export async function validateExternalUrl(
  rawUrl: string,
  allowedHosts?: string[]
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid external URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("SSRF blocked: only HTTPS outbound requests are permitted");
  }
  if (parsed.username || parsed.password) {
    throw new Error("SSRF blocked: URL credentials are not permitted");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("SSRF blocked: local hostnames are prohibited");
  }

  if (allowedHosts && allowedHosts.length > 0) {
    const allowedSet = new Set(allowedHosts.map((h) => h.toLowerCase()));
    if (!allowedSet.has(hostname)) {
      throw new Error(`SSRF blocked: host "${hostname}" is not in the explicit allowlist`);
    }
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error("SSRF blocked: private or reserved IP address");
    }
    return parsed;
  }

  const records = await dns.lookup(hostname, { all: true });
  if (records.length === 0) {
    throw new Error("SSRF blocked: hostname could not be resolved");
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error("SSRF blocked: hostname resolved to private or reserved IP");
    }
  }

  return parsed;
}

export async function safeServerFetch(
  rawUrl: string,
  init: RequestInit = {},
  allowedHosts?: string[]
): Promise<Response> {
  const validUrl = await validateExternalUrl(rawUrl, allowedHosts);
  return fetch(validUrl.toString(), {
    ...init,
    redirect: "error",
  });
}
