# Medora (`next-Medora`)

Multi-Hospital Online Prescription Platform built with **Next.js (TypeScript)**, **NextAuth**, **PostgreSQL (with Row Level Security)**, **Tailwind CSS**, **DaisyUI**, and **SweetAlert2**.

See [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) for full architecture, security controls, and persistent project memory.

## Quick Start

1. **Configure PostgreSQL credentials** in `.env.local`:
   Update `DATABASE_ADMIN_URL` with your local PostgreSQL admin credentials (the remaining cryptographic secrets in `.env.local` are pre-generated).

2. **Initialize database, least-privilege RLS role, and pilot seed data**:
   ```bash
   npm run db:setup
   npm run db:seed
   ```
   `db:seed` prints the randomly generated pilot password and seeded accounts for:
   - Platform Admin (`platform.admin@medora.health`)
   - Hospital Admins (`admin.northstar@medora.health`, `admin.crestview@medora.health`)
   - Multi-Hospital Doctor (`dr.selina@medora.health`)
   - Pharmacists (`pharm.harbor@medora.health`, `pharm.crest@medora.health`)
   - Patient (`patient.demo@medora.health` · Generator Code `MED-7492-XK8P`)

3. **Run the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

## Verification Commands

```bash
npm run typecheck
npm run security:check
npm run build
npm audit --audit-level=moderate
```
