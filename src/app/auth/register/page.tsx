"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, CheckCircle2, ArrowRight } from "lucide-react";
import { MedoraLogo } from "@/components/MedoraLogo";
import { apiFetch } from "@/lib/client/api";

export default function PatientRegisterPage() {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    username: "",
    phone: "",
    dateOfBirth: "",
    address: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{
    patientUid: string;
    username: string;
    generatorCode: string;
    generatorCodeNotice: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await apiFetch<{
      patientUid: string;
      username: string;
      generatorCode: string;
      generatorCodeNotice: string;
    }>("/api/auth/register/patient", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setBusy(false);

    if (!res.ok) {
      setError(res.data.error || "Registration failed.");
      return;
    }
    setCreated(res.data);
  }

  return (
    <div className="min-h-screen bg-medora-mist">
      <header className="border-b border-medora-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <MedoraLogo href="/" />
          <Link href="/auth/signin" className="text-sm font-semibold text-medora-teal hover:underline">
            Already have an account? Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-10">
        {created ? (
          <div className="medora-card p-8">
            <div className="flex items-center gap-3 text-emerald-700">
              <CheckCircle2 className="h-7 w-7" />
              <h1 className="text-2xl font-extrabold text-medora-navy">
                Patient Account Created
              </h1>
            </div>
            <p className="mt-3 text-sm text-medora-slate">{created.generatorCodeNotice}</p>

            <div className="mt-6 space-y-3 rounded-2xl border border-medora-teal/30 bg-medora-teal-soft/50 p-5">
              <div className="flex justify-between text-xs">
                <span className="font-semibold text-medora-slate">Immutable Patient ID</span>
                <span className="font-mono font-bold text-medora-navy">{created.patientUid}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="font-semibold text-medora-slate">Username</span>
                <span className="font-mono font-bold text-medora-navy">@{created.username}</span>
              </div>
              <div className="border-t border-medora-teal/20 pt-3 text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-medora-teal">
                  Prescription Generator Code (Shown Once)
                </p>
                <p className="mt-1.5 rounded-xl bg-white py-3 font-mono text-xl font-extrabold tracking-widest text-medora-navy shadow-sm">
                  {created.generatorCode}
                </p>
              </div>
            </div>

            <Link href="/auth/signin" className="medora-btn-primary mt-6 w-full">
              <span>Continue to Sign In</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="medora-card p-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-medora-teal-soft px-3 py-1 text-xs font-bold text-medora-teal">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>PATIENT REGISTRATION</span>
            </div>
            <h1 className="mt-4 text-2xl font-extrabold text-medora-navy">
              Create your patient account
            </h1>
            <p className="mt-1 text-sm text-medora-slate">
              We assign an immutable internal Patient ID so your prescriptions stay linked even if
              you update your username later.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-medora-navy">Full Name *</label>
                <input
                  required
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  className="input input-bordered w-full bg-white text-sm"
                  placeholder="Ayesha Siddiqua"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-medora-navy">Email *</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                    placeholder="ayesha@example.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-medora-navy">Username *</label>
                  <input
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                    placeholder="ayesha_s"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-medora-navy">Phone Number *</label>
                  <input
                    required
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                    placeholder="+8801711000000"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-medora-navy">
                    Date of Birth (Optional)
                  </label>
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-medora-navy">
                  Address (Optional)
                </label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="input input-bordered w-full bg-white text-sm"
                  placeholder="House, Road, City"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-medora-navy">
                  Strong Password * (min 12 chars, upper, lower, number, symbol)
                </label>
                <input
                  required
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="input input-bordered w-full bg-white text-sm"
                  placeholder="Min 12 characters"
                />
              </div>

              <button type="submit" disabled={busy} className="medora-btn-primary w-full">
                {busy ? "Creating Account..." : "Create Patient Account"}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
