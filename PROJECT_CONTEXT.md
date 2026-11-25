# Medora (`next-Medora`) — Project Context & Persistent Memory

> **Last Updated**: 2026-11-25
> **Project Root**: `/home/mashrafi47/Development Projects/next-Medora`
> **Source Artifacts**:
> - PRD: `/home/mashrafi47/Development Projects/Medora PRD and Design/Multi-Hospital Online Prescription Platform PRD.docx`
> - Design: `/home/mashrafi47/Development Projects/Medora PRD and Design/Medora.fig`

---

## 1. Project Purpose

**Medora** is a multi-hospital online prescription platform connecting **Patients**, **Verified Doctors**, **Pharmacists**, **Hospital Administrators**, and **Platform Administrators** with strong tenant isolation, identity verification, safe non-destructive prescription workflows, pharmacy fulfillment & catalog operations, sandbox Stripe/bKash checkout, and tamper-evident audit logging.

---

## 2. Technology Stack

- **Framework**: Next.js `16.4.6` (App Router) + React `19.1` + TypeScript `5.8` (strict mode)
- **Styling & UI**: Tailwind CSS `3.4`, DaisyUI `4.12`, SweetAlert2 `11.21`, Lucide React icons
- **Design System (from `Medora.fig`)**:
  - Primary Brand Teal `#0B7A7E` / `#14B8A6`, Deep Navy `#0F2437`, Secondary Slate `#526577`, Soft Mist `#EEF5F5` / `#F3F8F8`, Border `#DCE7E7`, Emerald Ready/Connected `#15803D` on `#DCFCE7`
  - Typography: `Plus Jakarta Sans` via `next/font/google`
- **Authentication**: NextAuth `4.24.13` with `httpOnly`, `SameSite=Lax` JWT session cookies, Node `crypto.scrypt` password hashing, lockout after 5 failed attempts, and RFC 6238 TOTP MFA (`qrcode` + AES-256-GCM encrypted secrets + single-use hashed recovery codes).
- **Database**: PostgreSQL (`pg`) with explicit SQL migrations, **Row Level Security (RLS)** enabled & forced across 11 tenant/clinical tables, least-privilege `medora_app` DB role, and tamper-evident SHA-256 hash-chained `audit_logs`.
- **Validation**: Zod `4.6.7` (`0` vulnerabilities verified by `npm audit`).

---

## 3. Architecture & Important Files

### Configuration & Database
- `next.config.ts` — CSP, HSTS (prod), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `productionBrowserSourceMaps: false`, `poweredByHeader: false`
- `src/middleware.ts` — Explicit `ALLOWED_ORIGINS` CORS enforcement (no wildcard `*` with credentials) + `Cache-Control: no-store` on `/api/*`
- `db/migrations/001_initial_schema.sql` — 17 normalized tables covering users, hospitals, pharmacies, hospital_memberships, patients, activation tokens, verification OTPs, generics, medicines, uploaded_files, prescriptions, prescription_items, payments, webhook_events, notifications, audit_logs, rate_limits
- `db/migrations/002_rls_policies.sql` — `ENABLE/FORCE ROW LEVEL SECURITY` + tenant/BOLA SQL policies using `current_setting('app.*', true)`
- `scripts/db-setup.mjs` — Creates `medora` DB, applies migrations, creates least-privilege `medora_app` role (`NOBYPASSRLS`) and locks `audit_logs` as append-only
- `scripts/db-seed.mjs` — Idempotent pilot seed (Northstar General + Harbor Pharmacy, Crestview Medical Center + Crestview Apothecary, multi-hospital Doctor, Pharmacists, Hospital & Platform Admins, Patient `MED-PAT-100101` + sample accepted prescription + catalog)
- `scripts/security-check.mjs` — Automated static + crypto verification of security controls

### Security, Auth & Payments (`src/lib/`)
- `src/lib/env.ts` — `server-only` validated env secrets; enforces `PAYMENT_MODE=sandbox`
- `src/lib/db.ts` — Parameterized `pg` pool + `withRlsContext(ctx, fn)` transaction wrapper setting `app.user_id`, `app.user_role`, `app.hospital_id`, `app.pharmacy_id`
- `src/lib/security/crypto.ts` — `scrypt` KDF, `AES-256-GCM` encryption, HMAC-SHA256, timing-safe comparisons, strong password validator
- `src/lib/security/totp.ts` — RFC 6238 TOTP generator/verifier, QR code payload, recovery codes
- `src/lib/security/csrf.ts` — Origin/Referer allowlist + signed double-submit CSRF cookie/header verification
- `src/lib/security/ssrf.ts` — `validateExternalUrl()` & `safeServerFetch()` blocking private/loopback/link-local/CGNAT/metadata IPs & non-HTTPS protocols
- `src/lib/security/upload.ts` — Magic-byte file signature verification (PNG/JPEG/WebP/PDF), 2 MB max, UUID storage filenames outside `public/`
- `src/lib/security/rate-limit.ts` — PostgreSQL-backed rate limiter with in-memory fallback
- `src/lib/security/logger.ts` — Redacting structured logger (scrubs passwords, tokens, OTPs, generator codes, PHI)
- `src/lib/security/audit.ts` — Serialized SHA-256 hash-chained audit writer
- `src/lib/auth/options.ts` & `src/lib/auth/guards.ts` — NextAuth config + centralized server-side RBAC, active approved hospital/pharmacy verification & BOLA guards
- `src/lib/payments/providers.ts` & `src/lib/payments/webhook-processor.ts` — Stripe & bKash sandbox abstraction, HMAC-SHA256 constant-time signature verification + 5-min replay window + idempotent `webhook_events` deduplication

### API Routes (`src/app/api/`)
- Auth & Identity: `/api/auth/[...nextauth]`, `/api/security/csrf`, `/api/auth/register/patient`, `/api/auth/register/staff`, `/api/auth/activate`, `/api/auth/mfa/setup`, `/api/auth/mfa/verify`, `/api/auth/context`, `/api/patient/profile`
- Doctor Clinical: `/api/doctor/patients/lookup`, `/api/doctor/patients/otp`, `/api/doctor/patients/verify`, `/api/doctor/patients/provision`, `/api/pharmacies/resolve`
- Prescriptions: `/api/prescriptions`, `/api/prescriptions/[id]` (BOLA GET, doctor cancel/route/non-destructive amend, pharmacist availability/pricing/fulfillment lifecycle)
- Catalog & Tenants: `/api/catalog/medicines`, `/api/catalog/generics`, `/api/hospitals`, `/api/admin/hospital`
- Payments & Webhooks: `/api/payments`, `/api/payments/sandbox-confirm`, `/api/webhooks/stripe`, `/api/webhooks/bkash`
- Uploads, Notifications, Audit: `/api/uploads`, `/api/uploads/[id]`, `/api/notifications`, `/api/audit`

### Frontend Pages (`src/app/`)
- `/` — Medora landing page faithfully implementing `Medora.fig`
- `/auth/signin`, `/auth/register`, `/auth/register-staff`, `/activate` — Full auth, TOTP MFA challenge, staff license registration, one-time patient activation
- `/browse` — Medicines & Generics browsing with pharmacy context & availability filters
- `/dashboard` — Server-side role router (blocks `PENDING_APPROVAL` staff cleanly)
- `/patient`, `/patient/checkout/[paymentId]` — Patient prescriptions, Stripe/bKash sandbox checkout, profile, one-time username change, generator code rotation
- `/doctor` — Multi-hospital doctor workspace (lookup, generator code/OTP verification, pending patient provisioning, pharmacy resolution, structured composer, review & sign, cancel)
- `/pharmacist` — Pharmacy prescription inbox, per-item availability & confirmed pricing, fulfillment milestones, medicine catalog + validated image uploads
- `/admin/hospital`, `/admin/platform` — Tenant-scoped staff approvals, pharmacy associations, hospital tenant management, hash-chained audit log viewers

---

## 4. Security Controls Matrix

| Category | Control | Implementation | Status |
|---|---|---|---|
| Injection & Input | SQL Injection | 100% parameterized `$1` queries via `pg` + Zod validation | Verified |
| Injection & Input | XSS | Strict CSP, input sanitization, React escaping, zero `dangerouslySetInnerHTML` | Verified |
| Injection & Input | CSRF | NextAuth CSRF + Origin/Referer validation + signed double-submit cookie/header | Verified |
| Injection & Input | File Uploads | Magic-byte inspection, MIME/ext allowlist, 2MB cap, UUID private storage | Verified |
| Injection & Input | SSRF | `validateExternalUrl()` blocking private/loopback/link-local/metadata IPs | Verified |
| Auth & Access | BOLA / IDOR | Centralized ownership/tenant/pharmacy guards + PostgreSQL RLS | Verified |
| Auth & Access | Rate Limiting | PostgreSQL-backed limiter on auth, OTP, lookup, MFA, prescriptions, uploads, payments | Verified |
| Auth & Access | Password Hashing | Node `crypto.scrypt` (`N=16384, r=8, p=1`, random salt, timing-safe compare) | Verified |
| Auth & Access | MFA | RFC 6238 TOTP with QR code, AES-256-GCM encrypted secret, hashed recovery codes | Verified |
| Auth & Access | Server-side RBAC | `requireApiAuth()` + active approved hospital/pharmacy verification | Verified |
| Auth & Access | PostgreSQL RLS | `ENABLE/FORCE ROW LEVEL SECURITY` on 11 tables + `withRlsContext()` | Verified |
| Secrets & Tokens | JWT Secrets | High-entropy `NEXTAUTH_SECRET` & `MEDORA_ENCRYPTION_KEY` validated at startup | Verified |
| Secrets & Tokens | Server-side Secrets | `server-only` `src/lib/env.ts`; zero `NEXT_PUBLIC_*` secrets | Verified |
| Secrets & Tokens | No Browser Token Storage | Strictly `httpOnly` cookies; zero browser storage auth tokens | Verified |
| Secrets & Tokens | Default Credentials | Strong password policy; random generated pilot seed password + `must_change_password` | Verified |
| Config & Hygiene | Strict CORS | Explicit `ALLOWED_ORIGINS` allowlist in `src/middleware.ts` | Verified |
| Config & Hygiene | Webhook Signatures | HMAC-SHA256 `crypto.timingSafeEqual` + 5-min timestamp window + idempotency | Verified |
| Config & Hygiene | Source Maps | `productionBrowserSourceMaps: false` + `poweredByHeader: false` | Verified |
| Config & Hygiene | Sensitive Logging | Redacting structured logger (`src/lib/security/logger.ts`) | Verified |
| Config & Hygiene | Vulnerable Deps | `npm audit` = **0 vulnerabilities** | Verified |

---

## 5. Implementation Status

### Completed Tasks
- [x] Inspected `Medora.fig` design assets and extracted exact visual system & landing layout.
- [x] Thoroughly analyzed `Multi-Hospital Online Prescription Platform PRD.docx`.
- [x] Created `next-Medora` project folder and persistent `PROJECT_CONTEXT.md`.
- [x] Bootstrapped Next.js 16 + TypeScript + Tailwind + DaisyUI + NextAuth + PostgreSQL with `0` npm vulnerabilities.
- [x] Authored PostgreSQL schema (`001_initial_schema.sql`), Row Level Security policies (`002_rls_policies.sql`), `db:setup`, and `db:seed`.
- [x] Implemented complete security layer, NextAuth + TOTP MFA, RBAC/BOLA guards, Stripe/bKash sandbox payment & HMAC webhook engine.
- [x] Built all 23 REST API route handlers covering every PRD workflow.
- [x] Built Medora landing page matching `Medora.fig` plus Auth, Activation, Browse, and all 5 role workspaces.
- [x] Passed TypeScript (`tsc --noEmit`), production build (`next build`), and automated security verification.
- [x] Configured local PostgreSQL `medora` database and ran `npm run db:setup` + `npm run db:seed` (migrations, RLS policies, `medora_app` role, and pilot tenants/accounts initialized).

### Pending Tasks
- [ ] Run `npm run dev` and test end-to-end role workflows (Platform Admin, Hospital Admin, multi-hospital Doctor, Pharmacist, Patient sandbox checkout, TOTP MFA).
- [ ] Connect live sandbox API keys for Stripe / bKash and an approved SMS/email provider when moving to external pilot testing.
- [ ] Add Playwright end-to-end tests exercising cross-tenant isolation and full Doctor → Pharmacy → Patient sandbox payment lifecycle against PostgreSQL.

### Known Issues & Environment Notes
- Local PostgreSQL `medora` database is initialized and seeded with the least-privilege `medora_app` RLS role.

### Important Technical Decisions
1. **PostgreSQL + `pg` with explicit SQL migrations & RLS (`medora_app` role with `NOBYPASSRLS`)**: Enforces database-level tenant and patient isolation independent of application code.
2. **Next.js 16.4.6 + Zod 4.6.7 + PostCSS 8.5.23**: Selected to eliminate all PostCSS/Zod advisories and achieve `0` vulnerabilities on `npm audit`.
3. **Signed Sandbox Webhook Simulator**: Sandbox checkout flows execute real HMAC-SHA256 signature verification and idempotent `webhook_events` deduplication rather than trusting client-side redirects.

---

## 6. Exact Next Step

Start the development server (`npm run dev`), sign in at `http://localhost:3000/auth/signin` using the seeded pilot accounts, and verify the end-to-end Doctor → Pharmacy → Patient sandbox checkout and TOTP MFA flows.
