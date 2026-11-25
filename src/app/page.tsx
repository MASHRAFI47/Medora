import Link from "next/link";
import {
  ArrowRight,
  Building2,
  Check,
  Clock,
  FileText,
  Pill,
  Shield,
  ShieldCheck,
  Stethoscope,
  UserCheck,
  CreditCard,
  Lock,
  FlaskConical,
  Search,
} from "lucide-react";
import { MedoraIcon, MedoraLogo } from "@/components/MedoraLogo";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-medora-navy">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-medora-border/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <MedoraLogo href="/" />

          <nav
            aria-label="Primary"
            className="hidden items-center gap-8 text-sm font-medium text-medora-slate md:flex"
          >
            <a href="#how-it-works" className="transition hover:text-medora-navy">
              How it works
            </a>
            <a href="#healthcare-teams" className="transition hover:text-medora-navy">
              For healthcare teams
            </a>
            <a href="#medicine-directory" className="transition hover:text-medora-navy">
              Medicine directory
            </a>
          </nav>

          <div className="flex items-center gap-3 sm:gap-5">
            <Link
              href="/auth/signin"
              className="text-sm font-semibold text-medora-teal transition hover:text-medora-teal-dark"
            >
              Patient sign in
            </Link>
            <Link
              href="/auth/signin?portal=staff"
              className="rounded-xl border border-medora-border bg-white px-4 py-2 text-sm font-semibold text-medora-navy transition hover:border-medora-teal/40 hover:bg-medora-mist"
            >
              Staff access
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-7xl px-4 pb-12 pt-12 sm:px-6 lg:px-8 lg:pt-16">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          {/* Left Column */}
          <div className="lg:col-span-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-medora-teal-soft px-3.5 py-1.5 text-xs font-bold tracking-wider text-medora-teal">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>SECURE PRESCRIPTION ACCESS</span>
            </div>

            <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-medora-navy sm:text-5xl lg:text-[3.5rem]">
              Prescriptions,
              <br />
              connected to your
              <br />
              care.
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-medora-slate sm:text-lg">
              Medora gives patients and healthcare teams one clear, secure place to send,
              review, and track prescriptions across participating hospitals and pharmacies.
            </p>

            {/* Redesigned Hero CTAs (non-redundant with top bar auth links) */}
            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <Link href="/browse" className="medora-btn-primary px-6 py-3.5 text-sm">
                <Search className="h-4 w-4" aria-hidden="true" />
                <span>Explore medicines &amp; generics</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <a href="#how-it-works" className="medora-btn-outline px-6 py-3.5 text-sm">
                See how it works
              </a>
            </div>

            <div className="mt-7 space-y-2.5 text-sm text-medora-slate">
              <p>
                Are you a doctor or pharmacist?{" "}
                <Link
                  href="/auth/register-staff"
                  className="inline-flex items-center gap-1 font-semibold text-medora-teal hover:underline"
                >
                  <span>Request verified staff access</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </p>
              <p className="flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-medora-teal" aria-hidden="true" />
                <span>Have a patient activation link or code?</span>{" "}
                <Link
                  href="/activate"
                  className="font-semibold text-medora-teal hover:underline"
                >
                  Activate account
                </Link>
              </p>
            </div>
          </div>

          {/* Right Column: Orbital Connected Network Visual */}
          <div className="lg:col-span-6">
            <div className="relative mx-auto aspect-[5/4] max-w-xl overflow-hidden rounded-3xl bg-gradient-to-br from-[#EEF5F5] to-[#E6F1F1] p-6 shadow-inner sm:p-8">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-[82%] w-[82%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-medora-teal/15"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 h-[56%] w-[56%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-medora-teal/20"
              />

              {/* Top-left floating Hospital Card */}
              <div className="relative z-10 max-w-[235px] rounded-2xl border border-white/80 bg-white p-4 shadow-float">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-medora-teal-soft text-medora-teal">
                    <Building2 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-medora-slate">
                      HOSPITAL
                    </p>
                    <p className="text-sm font-bold text-medora-navy">Northstar General</p>
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                      <Check className="h-3 w-3" aria-hidden="true" /> Ready
                    </span>
                  </div>
                </div>
              </div>

              {/* Center Medora Hub */}
              <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-center">
                <div className="mx-auto flex justify-center drop-shadow-lg">
                  <MedoraIcon size={56} />
                </div>
                <p className="mt-4 text-sm font-bold text-medora-navy">Securely connected</p>
                <p className="text-xs text-medora-slate">Protected at every step</p>
              </div>

              {/* Bottom-left Prescription Received Toast */}
              <div className="absolute bottom-6 left-6 z-10 hidden items-center gap-3 rounded-2xl border border-white/80 bg-white px-4 py-3 shadow-float sm:flex">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-medora-teal-soft text-medora-teal">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs font-bold text-medora-navy">Prescription received</p>
                  <p className="text-[11px] text-medora-slate">Ready for pharmacy review</p>
                </div>
                <Check className="ml-1 h-4 w-4 text-emerald-600" aria-hidden="true" />
              </div>

              {/* Bottom-right Pharmacy Card */}
              <div className="absolute bottom-8 right-6 z-10 max-w-[230px] rounded-2xl border border-white/80 bg-white p-4 shadow-float">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-medora-teal-soft text-medora-teal">
                    <Pill className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-medora-slate">
                      PHARMACY
                    </p>
                    <p className="text-sm font-bold text-medora-navy">Harbor Pharmacy</p>
                    <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> Connected
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3-Column Trust Bar */}
        <div className="mt-12 rounded-2xl border border-medora-border bg-[#FAFDFD] px-6 py-5 shadow-sm">
          <div className="grid gap-6 divide-y divide-medora-border md:grid-cols-3 md:divide-x md:divide-y-0">
            <div className="flex items-center gap-3.5 pt-2 md:justify-center md:pt-0">
              <Shield className="h-5 w-5 shrink-0 text-medora-teal" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-medora-navy">Private by design</p>
                <p className="text-xs text-medora-slate">Your information stays protected.</p>
              </div>
            </div>

            <div className="flex items-center gap-3.5 pt-4 md:justify-center md:pl-6 md:pt-0">
              <Building2 className="h-5 w-5 shrink-0 text-medora-teal" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-medora-navy">Connected care</p>
                <p className="text-xs text-medora-slate">
                  One account across participating providers.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3.5 pt-4 md:justify-center md:pl-6 md:pt-0">
              <Clock className="h-5 w-5 shrink-0 text-medora-teal" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-medora-navy">Clear updates</p>
                <p className="text-xs text-medora-slate">
                  Know when your prescription is ready.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: HOW IT WORKS */}
      <section id="how-it-works" className="border-t border-medora-border/70 bg-medora-mist py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-medora-teal">
              HOW IT WORKS
            </p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-medora-navy sm:text-4xl">
              A simpler path from prescription to pharmacy
            </h2>
            <p className="mt-3 text-base text-medora-slate">
              See each step without chasing calls or paperwork.
            </p>
          </div>

          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                step: "01",
                icon: UserCheck,
                title: "Verified patient lookup",
                desc: "Doctors confirm identity via Prescription Generator Code, time-limited OTP, or secure one-time account activation.",
              },
              {
                step: "02",
                icon: Stethoscope,
                title: "Structured prescribing",
                desc: "Clinicians review dose, route, frequency, and duration, then route directly to an approved hospital pharmacy.",
              },
              {
                step: "03",
                icon: Pill,
                title: "Pharmacy confirmation",
                desc: "Authorized pharmacists verify availability, confirm transparent pricing, or request doctor clarification.",
              },
              {
                step: "04",
                icon: CreditCard,
                title: "Sandbox checkout & pickup",
                desc: "Patients pay confirmed totals via Stripe or bKash sandbox with HMAC-verified webhooks and pickup instructions.",
              },
            ].map((item) => (
              <div key={item.step} className="medora-card p-6">
                <div className="flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-medora-teal-soft text-medora-teal">
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <span className="font-mono text-xs font-bold text-medora-slate">
                    STEP {item.step}
                  </span>
                </div>
                <h3 className="mt-5 text-base font-bold text-medora-navy">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-medora-slate">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Section 3: FOR HEALTHCARE TEAMS */}
      <section id="healthcare-teams" className="bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-medora-teal">
              FOR HEALTHCARE TEAMS
            </p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-medora-navy sm:text-4xl">
              Tenant-isolated workspaces for every role
            </h2>
            <p className="mt-3 text-base text-medora-slate">
              Backed by PostgreSQL Row Level Security, server-side RBAC, TOTP MFA, and
              tamper-evident audit chains.
            </p>
          </div>

          <div className="mt-14 grid gap-6 md:grid-cols-3">
            <div className="medora-card p-6">
              <Stethoscope className="h-6 w-6 text-medora-teal" />
              <h3 className="mt-4 text-lg font-bold text-medora-navy">Verified Doctors</h3>
              <p className="mt-2 text-sm text-medora-slate">
                Switch explicitly between affiliated hospitals, confirm patient identity safely,
                issue non-destructive amendments, and route to approved pharmacies.
              </p>
            </div>
            <div className="medora-card p-6">
              <Pill className="h-6 w-6 text-medora-teal" />
              <h3 className="mt-4 text-lg font-bold text-medora-navy">Hospital Pharmacists</h3>
              <p className="mt-2 text-sm text-medora-slate">
                Receive routed prescriptions in a dedicated pharmacy inbox, manage branded &amp;
                generic catalogs, confirm pricing, and update fulfillment milestones.
              </p>
            </div>
            <div className="medora-card p-6">
              <Lock className="h-6 w-6 text-medora-teal" />
              <h3 className="mt-4 text-lg font-bold text-medora-navy">Hospital Administrators</h3>
              <p className="mt-2 text-sm text-medora-slate">
                Verify clinician licenses, associate pharmacy locations, suspend access instantly,
                and review tenant-scoped hash-chained audit logs.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: MEDICINE DIRECTORY (Redesigned cleanly, single Browse CTA) */}
      <section
        id="medicine-directory"
        className="border-t border-medora-border bg-medora-mist py-20"
      >
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="medora-card relative overflow-hidden bg-gradient-to-br from-white via-white to-medora-teal-soft/45 p-8 text-center sm:p-12">
            <div className="inline-flex items-center gap-2 rounded-full bg-medora-teal-soft px-3.5 py-1 text-xs font-bold uppercase tracking-widest text-medora-teal">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
              <span>MEDICINE DIRECTORY</span>
            </div>

            <h2 className="mx-auto mt-4 max-w-2xl text-2xl font-extrabold tracking-tight text-medora-navy sm:text-3xl">
              Check medicines, generics, and pharmacy availability upfront
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-medora-slate sm:text-base">
              Browse pharmacist-maintained branded medicines and active generic ingredients across
              participating hospital pharmacies with transparent pricing and stock status.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs font-semibold text-medora-navy">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-medora-border bg-white px-3.5 py-1.5">
                <Pill className="h-3.5 w-3.5 text-medora-teal" aria-hidden="true" />
                Branded Medicines
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-medora-border bg-white px-3.5 py-1.5">
                <FlaskConical className="h-3.5 w-3.5 text-medora-teal" aria-hidden="true" />
                Active Generics
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-medora-border bg-white px-3.5 py-1.5">
                <Building2 className="h-3.5 w-3.5 text-medora-teal" aria-hidden="true" />
                Hospital-Verified Pharmacies
              </span>
            </div>

            <div className="mt-8">
              <Link href="/browse" className="medora-btn-primary px-7 py-3.5 text-sm">
                <span>Browse Medicines &amp; Generics</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-medora-navy/10 bg-medora-navy text-slate-300">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-12">
            <div className="md:col-span-5">
              <MedoraLogo href="/" inverted />
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-300">
                Multi-hospital online prescription platform connecting patients, verified doctors,
                and hospital pharmacies with tenant-isolated security.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-6 text-sm sm:grid-cols-2 md:col-span-7 md:justify-items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-medora-teal-light">
                  Platform
                </p>
                <ul className="mt-3 space-y-2 text-slate-300">
                  <li>
                    <a href="#how-it-works" className="transition hover:text-white">
                      How it works
                    </a>
                  </li>
                  <li>
                    <a href="#healthcare-teams" className="transition hover:text-white">
                      For healthcare teams
                    </a>
                  </li>
                  <li>
                    <Link href="/browse" className="transition hover:text-white">
                      Medicine directory
                    </Link>
                  </li>
                </ul>
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-medora-teal-light">
                  Access
                </p>
                <ul className="mt-3 space-y-2 text-slate-300">
                  <li>
                    <Link href="/auth/signin" className="transition hover:text-white">
                      Patient sign in
                    </Link>
                  </li>
                  <li>
                    <Link href="/auth/signin?portal=staff" className="transition hover:text-white">
                      Staff access
                    </Link>
                  </li>
                  <li>
                    <Link href="/activate" className="transition hover:text-white">
                      Activate patient account
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6">
            <p className="text-sm font-semibold text-white">
              &copy; {new Date().getFullYear()} Medora Health Platform. All rights reserved.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-medora-teal-light/30 bg-medora-teal/20 px-3.5 py-1 text-xs font-bold tracking-wide text-medora-teal-light">
                Web Version 1.0
              </span>
              <span className="text-xs text-slate-400">
                Pilot Sandbox · Tenant-Isolated &amp; Audited
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
