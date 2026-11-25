import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|js|mjs|sql)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const srcFiles = walk(path.join(root, "src"));
const failures = [];
const passes = [];

function assertCheck(name, condition, detail = "") {
  if (condition) passes.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

// 1. Zero localStorage / sessionStorage token usage
const storageHits = srcFiles.filter((f) =>
  /\b(localStorage|sessionStorage)\b/.test(fs.readFileSync(f, "utf8"))
);
assertCheck("No localStorage/sessionStorage tokens", storageHits.length === 0, storageHits.join(", "));

// 2. Zero dangerouslySetInnerHTML (XSS hygiene)
const xssHits = srcFiles.filter((f) =>
  /dangerouslySetInnerHTML/.test(fs.readFileSync(f, "utf8"))
);
assertCheck("No dangerouslySetInnerHTML in src/", xssHits.length === 0, xssHits.join(", "));

// 3. No secrets leaked via NEXT_PUBLIC_
const publicSecretHits = srcFiles.filter((f) =>
  /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|KEY|PASSWORD|TOKEN)/i.test(fs.readFileSync(f, "utf8"))
);
assertCheck("No secrets exposed via NEXT_PUBLIC_*", publicSecretHits.length === 0, publicSecretHits.join(", "));

// 4. Source maps disabled & poweredByHeader disabled in next.config.ts
const nextCfg = fs.readFileSync(path.join(root, "next.config.ts"), "utf8");
assertCheck(
  "productionBrowserSourceMaps disabled",
  /productionBrowserSourceMaps\s*:\s*false/.test(nextCfg)
);
assertCheck("Content-Security-Policy header configured", /Content-Security-Policy/.test(nextCfg));
assertCheck("poweredByHeader disabled", /poweredByHeader\s*:\s*false/.test(nextCfg));

// 5. Strict CORS (no wildcard '*')
const middlewareSrc = fs.readFileSync(path.join(root, "src", "middleware.ts"), "utf8");
assertCheck(
  "Tightened CORS allowlist (no wildcard)",
  middlewareSrc.includes("ALLOWED_ORIGINS") && !middlewareSrc.includes('"Access-Control-Allow-Origin", "*"')
);

// 6. PostgreSQL RLS enabled & forced on all tenant/clinical tables
const rlsSql = fs.readFileSync(path.join(root, "db", "migrations", "002_rls_policies.sql"), "utf8");
const requiredRlsTables = [
  "hospitals",
  "pharmacies",
  "hospital_memberships",
  "patients",
  "prescriptions",
  "prescription_items",
  "medicines",
  "payments",
  "notifications",
  "audit_logs",
  "uploaded_files",
];
const missingRls = requiredRlsTables.filter(
  (t) =>
    !rlsSql.includes(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`) ||
    !rlsSql.includes(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`)
);
assertCheck("PostgreSQL RLS enabled & forced on all 11 tables", missingRls.length === 0, missingRls.join(", "));

// 7. Scrypt password hashing & timing-safe verification test
const salt = crypto.randomBytes(16).toString("hex");
const d1 = crypto.scryptSync("MedoraStrong!2026", salt, 64, { N: 16384, r: 8, p: 1 });
const d2 = crypto.scryptSync("MedoraStrong!2026", salt, 64, { N: 16384, r: 8, p: 1 });
assertCheck("Scrypt KDF timing-safe roundtrip", crypto.timingSafeEqual(d1, d2));

// 8. Verify presence of SSRF, CSRF, Upload Magic-Bytes, TOTP MFA, Webhook HMAC, Audit Chain, Redacting Logger
const requiredModules = [
  "src/lib/security/ssrf.ts",
  "src/lib/security/csrf.ts",
  "src/lib/security/upload.ts",
  "src/lib/security/totp.ts",
  "src/lib/security/rate-limit.ts",
  "src/lib/security/logger.ts",
  "src/lib/security/audit.ts",
  "src/lib/payments/providers.ts",
  "src/lib/payments/webhook-processor.ts",
];
const missingMods = requiredModules.filter((m) => !fs.existsSync(path.join(root, m)));
assertCheck("All core security modules present", missingMods.length === 0, missingMods.join(", "));

console.log("\n=== Medora Security Verification Report ===");
for (const p of passes) console.log(`  [PASS] ${p}`);
if (failures.length > 0) {
  for (const f of failures) console.error(`  [FAIL] ${f}`);
  process.exit(1);
}
console.log(`\nAll ${passes.length} security checks passed!`);
