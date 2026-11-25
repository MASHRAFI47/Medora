"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldAlert, CheckCircle2, Stethoscope, Pill } from "lucide-react";
import { MedoraLogo } from "@/components/MedoraLogo";
import { apiFetch } from "@/lib/client/api";

interface HospitalOption {
  id: string;
  name: string;
  pharmacies: Array<{ id: string; name: string; code: string }>;
}

export default function StaffRegisterPage() {
  const [hospitals, setHospitals] = useState<HospitalOption[]>([]);
  const [form, setForm] = useState({
    role: "DOCTOR" as "DOCTOR" | "PHARMACIST",
    fullName: "",
    email: "",
    username: "",
    phone: "",
    hospitalId: "",
    pharmacyId: "",
    licenseNumber: "",
    issuingJurisdiction: "Bangladesh",
    specialty: "",
    credentials: "",
    workplaceAffiliation: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ hospitals: HospitalOption[] }>("/api/hospitals").then((res) => {
      if (res.ok && res.data.hospitals) {
        setHospitals(res.data.hospitals);
      }
    });
  }, []);

  const selectedHospital = hospitals.find((h) => h.id === form.hospitalId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await apiFetch("/api/auth/register/staff", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error || "Staff registration failed.");
      return;
    }
    setSuccess(res.data.message || "Verification request submitted.");
  }

  return (
    <div className="min-h-screen bg-medora-mist">
      <header className="border-b border-medora-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <MedoraLogo href="/" />
          <Link
            href="/auth/signin?portal=staff"
            className="text-sm font-semibold text-medora-teal hover:underline"
          >
            Already verified? Staff sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        {success ? (
          <div className="medora-card p-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <h1 className="mt-4 text-2xl font-extrabold text-medora-navy">
              Verification Request Submitted
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-medora-slate">
              {success}
            </p>
            <Link href="/auth/signin?portal=staff" className="medora-btn-primary mt-6">
              Go to Staff Sign In
            </Link>
          </div>
        ) : (
          <div className="medora-card p-8">
            <h1 className="text-2xl font-extrabold text-medora-navy">
              Healthcare Staff Verification &amp; Registration
            </h1>
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <p>
                <strong>Approval Required:</strong> Submitting this form initiates license
                verification with your selected Hospital Administrator. Clinical prescribing and
                pharmacy catalog/inbox access remain blocked server-side until approved.
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-800"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, role: "DOCTOR", pharmacyId: "" })}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold transition ${
                    form.role === "DOCTOR"
                      ? "border-medora-teal bg-medora-teal-soft text-medora-teal"
                      : "border-medora-border bg-white text-medora-slate"
                  }`}
                >
                  <Stethoscope className="h-4 w-4" /> Doctor
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, role: "PHARMACIST" })}
                  className={`flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-bold transition ${
                    form.role === "PHARMACIST"
                      ? "border-medora-teal bg-medora-teal-soft text-medora-teal"
                      : "border-medora-border bg-white text-medora-slate"
                  }`}
                >
                  <Pill className="h-4 w-4" /> Pharmacist
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold">Legal Full Name *</label>
                  <input
                    required
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Work Email *</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Username *</label>
                  <input
                    required
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Phone *</label>
                  <input
                    required
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    Requested Hospital Tenant *
                  </label>
                  <select
                    required
                    value={form.hospitalId}
                    onChange={(e) =>
                      setForm({ ...form, hospitalId: e.target.value, pharmacyId: "" })
                    }
                    className="select select-bordered w-full bg-white text-sm"
                  >
                    <option value="">Select participating hospital</option>
                    {hospitals.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </div>

                {form.role === "PHARMACIST" && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold">
                      Requested Pharmacy Location
                    </label>
                    <select
                      value={form.pharmacyId}
                      onChange={(e) => setForm({ ...form, pharmacyId: e.target.value })}
                      className="select select-bordered w-full bg-white text-sm"
                    >
                      <option value="">Select pharmacy (or admin assigns)</option>
                      {(selectedHospital?.pharmacies || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    License / Registration Number *
                  </label>
                  <input
                    required
                    value={form.licenseNumber}
                    onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
                    placeholder={form.role === "DOCTOR" ? "e.g., BMDC-A-55102" : "e.g., PCB-A-20911"}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    Issuing Jurisdiction *
                  </label>
                  <input
                    required
                    value={form.issuingJurisdiction}
                    onChange={(e) => setForm({ ...form, issuingJurisdiction: e.target.value })}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    {form.role === "DOCTOR" ? "Clinical Specialty" : "Pharmacy Focus"}
                  </label>
                  <input
                    value={form.specialty}
                    onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                    placeholder={form.role === "DOCTOR" ? "Cardiology, Internal Medicine" : "Clinical Dispensing"}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold">Credentials</label>
                  <input
                    value={form.credentials}
                    onChange={(e) => setForm({ ...form, credentials: e.target.value })}
                    placeholder={form.role === "DOCTOR" ? "MBBS, FCPS" : "B.Pharm, M.Pharm"}
                    className="input input-bordered w-full bg-white text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold">
                  Strong Password * (min 12 chars, upper, lower, number, symbol)
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
                {busy ? "Submitting Verification..." : "Submit Staff Verification Request"}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
