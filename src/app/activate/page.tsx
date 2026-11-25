"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound, ArrowRight } from "lucide-react";
import { MedoraLogo } from "@/components/MedoraLogo";
import { apiFetch } from "@/lib/client/api";

function ActivateForm() {
  const params = useSearchParams();
  const [form, setForm] = useState({
    activationCode: params.get("code") || "",
    username: "",
    email: "",
    dateOfBirth: "",
    address: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{
    username: string;
    patientUid: string;
    generatorCode: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await apiFetch<{
      username: string;
      patientUid: string;
      generatorCode: string;
    }>("/api/auth/activate", {
      method: "POST",
      body: JSON.stringify({
        activationCode: form.activationCode,
        ...(form.username ? { username: form.username } : {}),
        ...(form.email ? { email: form.email } : {}),
        ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
        ...(form.address ? { address: form.address } : {}),
        password: form.password,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error || "Activation failed.");
      return;
    }
    setDone(res.data);
  }

  return (
    <div className="min-h-screen bg-medora-mist">
      <header className="border-b border-medora-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <MedoraLogo href="/" />
          <Link href="/auth/signin" className="text-sm font-semibold text-medora-teal hover:underline">
            Patient Sign In
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-10">
        {done ? (
          <div className="medora-card p-8">
            <div className="flex items-center gap-3 text-emerald-700">
              <CheckCircle2 className="h-7 w-7" />
              <h1 className="text-2xl font-extrabold text-medora-navy">Account Activated</h1>
            </div>
            <p className="mt-2 text-sm text-medora-slate">
              Your password is set and your prescriptions are ready to view. Save your one-time
              Prescription Generator Code below.
            </p>
            <div className="mt-5 space-y-2 rounded-2xl border border-medora-teal/30 bg-medora-teal-soft/40 p-5 text-xs">
              <p>
                <strong>Patient UID:</strong> <span className="font-mono">{done.patientUid}</span>
              </p>
              <p>
                <strong>Username:</strong> <span className="font-mono">@{done.username}</span>
              </p>
              <div className="mt-3 rounded-xl bg-white p-3 text-center">
                <p className="text-[11px] font-bold uppercase text-medora-teal">
                  Prescription Generator Code
                </p>
                <p className="mt-1 font-mono text-xl font-extrabold tracking-widest text-medora-navy">
                  {done.generatorCode}
                </p>
              </div>
            </div>
            <Link href="/auth/signin" className="medora-btn-primary mt-6 w-full">
              Sign in to View Prescriptions <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="medora-card p-8">
            <div className="inline-flex items-center gap-2 rounded-full bg-medora-teal-soft px-3 py-1 text-xs font-bold text-medora-teal">
              <KeyRound className="h-3.5 w-3.5" />
              <span>ONE-TIME PATIENT ACTIVATION</span>
            </div>
            <h1 className="mt-4 text-2xl font-extrabold text-medora-navy">
              Activate your Medora account
            </h1>
            <p className="mt-1.5 text-sm text-medora-slate">
              Enter the time-limited activation code provided during your hospital visit and choose
              your own secure password.
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
                <label className="mb-1 block text-xs font-semibold">One-Time Activation Code *</label>
                <input
                  required
                  value={form.activationCode}
                  onChange={(e) => setForm({ ...form, activationCode: e.target.value })}
                  placeholder="ACT-XXXXXXXXXXXX"
                  className="input input-bordered w-full bg-white font-mono text-sm"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    Preferred Username (Optional)
                  </label>
                  <input
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="choose_username"
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Email (Optional)</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold">
                  Create Strong Password * (min 12 chars, upper, lower, number, symbol)
                </label>
                <input
                  required
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="input input-bordered w-full bg-white text-sm"
                />
              </div>

              <button type="submit" disabled={busy} className="medora-btn-primary w-full">
                {busy ? "Activating Account..." : "Activate Account & Set Password"}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ActivatePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-medora-mist" />}>
      <ActivateForm />
    </Suspense>
  );
}
