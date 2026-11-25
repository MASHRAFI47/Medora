"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Swal from "sweetalert2";
import {
  CreditCard,
  FileText,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  User,
  Wallet,
} from "lucide-react";
import { PortalShell } from "@/components/PortalShell";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch, formatMoney } from "@/lib/client/api";

interface PrescriptionItem {
  id: string;
  medicine_name: string;
  generic_name: string | null;
  strength: string;
  dosage_form: string;
  dose: string;
  route: string;
  frequency: string;
  duration: string;
  quantity: number;
  refills: number;
  availability_status: string;
  confirmed_unit_price_cents: number;
  line_total_cents: number;
  instructions: string | null;
}

interface Prescription {
  id: string;
  prescription_number: string;
  status: string;
  hospital_name: string;
  doctor_name: string;
  pharmacy_name: string | null;
  pharmacy_address: string | null;
  clinical_notes: string | null;
  pharmacist_notes: string | null;
  pickup_instructions: string | null;
  pricing_confirmed: boolean;
  total_amount_cents: number;
  currency: string;
  created_at: string;
  items: PrescriptionItem[];
  latest_payment: {
    id: string;
    provider: string;
    status: string;
    amount_cents: number;
    currency: string;
    provider_transaction_ref: string | null;
    verified_via_webhook: boolean;
  } | null;
}

interface PatientProfile {
  patient_uid: string;
  full_name: string;
  username: string;
  username_changed_at: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  address: string | null;
  allergies: string | null;
  emergency_contact: string | null;
  generator_code_updated_at: string | null;
}

export default function PatientPortalPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"PRESCRIPTIONS" | "PROFILE">("PRESCRIPTIONS");
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [profileForm, setProfileForm] = useState({
    fullName: "",
    phone: "",
    address: "",
    allergies: "",
    emergencyContact: "",
  });
  const [newUsername, setNewUsername] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [rxRes, profRes] = await Promise.all([
      apiFetch<{ prescriptions: Prescription[] }>("/api/prescriptions"),
      apiFetch<{ profile: PatientProfile }>("/api/patient/profile"),
    ]);
    if (rxRes.ok && rxRes.data.prescriptions) setPrescriptions(rxRes.data.prescriptions);
    if (profRes.ok && profRes.data.profile) {
      const p = profRes.data.profile;
      setProfile(p);
      setProfileForm({
        fullName: p.full_name || "",
        phone: p.phone || "",
        address: p.address || "",
        allergies: p.allergies || "",
        emergencyContact: p.emergency_contact || "",
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function initiatePayment(rx: Prescription, provider: "STRIPE_SANDBOX" | "BKASH_SANDBOX") {
    const idempotencyKey = `medora-${rx.id}-${provider}-${Date.now()}`;
    const res = await apiFetch<{ checkoutUrl: string }>("/api/payments", {
      method: "POST",
      body: JSON.stringify({
        prescriptionId: rx.id,
        provider,
        idempotencyKey,
      }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Checkout blocked", text: res.data.error });
      return;
    }
    router.push(res.data.checkoutUrl);
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch("/api/patient/profile", {
      method: "PATCH",
      body: JSON.stringify({ action: "UPDATE_PROFILE", ...profileForm }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Update failed", text: res.data.error });
      return;
    }
    Swal.fire({ icon: "success", title: "Profile saved", timer: 1500, showConfirmButton: false });
    loadAll();
  }

  async function handleUsernameChange() {
    const res = await apiFetch("/api/patient/profile", {
      method: "PATCH",
      body: JSON.stringify({
        action: "CHANGE_USERNAME",
        newUsername,
        currentPassword: reauthPassword,
      }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Username change failed", text: res.data.error });
      return;
    }
    setNewUsername("");
    setReauthPassword("");
    Swal.fire({ icon: "success", title: "Username updated", text: res.data.message });
    loadAll();
  }

  async function handleRegenerateCode() {
    const { value: password } = await Swal.fire({
      title: "Regenerate Prescription Generator Code",
      text: "This immediately revokes your previous code. Confirm your current password:",
      input: "password",
      inputPlaceholder: "Enter current password",
      showCancelButton: true,
      confirmButtonColor: "#0B7A7E",
    });
    if (!password) return;

    const res = await apiFetch<{ generatorCode: string }>("/api/patient/profile", {
      method: "PATCH",
      body: JSON.stringify({ action: "REGENERATE_CODE", currentPassword: password }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Could not regenerate", text: res.data.error });
      return;
    }
    await Swal.fire({
      icon: "success",
      title: "New Generator Code (Shown Once)",
      html: `<p style="font-size:13px;color:#526577;margin-bottom:10px">Store this securely. Previous code is revoked.</p><div style="font-family:monospace;font-size:20px;font-weight:800;padding:12px;background:#F3F8F8;border-radius:10px">${res.data.generatorCode}</div>`,
      confirmButtonColor: "#0B7A7E",
    });
    loadAll();
  }

  async function handlePasswordChange() {
    const res = await apiFetch("/api/patient/profile", {
      method: "PATCH",
      body: JSON.stringify({
        action: "CHANGE_PASSWORD",
        currentPassword: reauthPassword,
        newPassword,
      }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Password update failed", text: res.data.error });
      return;
    }
    setReauthPassword("");
    setNewPassword("");
    Swal.fire({ icon: "success", title: "Password updated securely" });
  }

  return (
    <PortalShell
      title="Patient Care Workspace"
      subtitle="Track prescriptions, pharmacy confirmation, pickup instructions, and sandbox checkout."
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-medora-border bg-white p-1">
          <button
            type="button"
            onClick={() => setTab("PRESCRIPTIONS")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "PRESCRIPTIONS"
                ? "bg-medora-teal text-white"
                : "text-medora-slate hover:text-medora-navy"
            }`}
          >
            <FileText className="h-4 w-4" /> My Prescriptions ({prescriptions.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("PROFILE")}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
              tab === "PROFILE"
                ? "bg-medora-teal text-white"
                : "text-medora-slate hover:text-medora-navy"
            }`}
          >
            <User className="h-4 w-4" /> Profile &amp; Generator Code
          </button>
        </div>

        {profile && (
          <div className="inline-flex items-center gap-2 rounded-xl border border-medora-border bg-white px-3.5 py-2 text-xs">
            <ShieldCheck className="h-4 w-4 text-medora-teal" />
            <span className="text-medora-slate">Patient ID:</span>
            <span className="font-mono font-bold text-medora-navy">{profile.patient_uid}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-56 animate-pulse rounded-2xl bg-white" />
      ) : tab === "PRESCRIPTIONS" ? (
        <div className="space-y-5">
          {prescriptions.length === 0 ? (
            <div className="medora-card p-10 text-center text-sm text-medora-slate">
              No prescriptions found yet. When a verified doctor issues a prescription for{" "}
              <strong className="font-mono">{profile?.patient_uid}</strong>, it will appear here
              automatically.
            </div>
          ) : (
            prescriptions.map((rx) => {
              const isPaid = rx.latest_payment?.status === "SUCCEEDED";
              const canPay =
                rx.pricing_confirmed &&
                rx.total_amount_cents > 0 &&
                !isPaid &&
                !["CANCELLED", "AMENDED", "REJECTED_UNAVAILABLE"].includes(rx.status);

              return (
                <article key={rx.id} className="medora-card p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-medora-border pb-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="font-mono text-lg font-extrabold text-medora-navy">
                          {rx.prescription_number}
                        </h2>
                        <StatusBadge status={rx.status} />
                        {rx.latest_payment && <StatusBadge status={rx.latest_payment.status} />}
                      </div>
                      <p className="mt-1 text-xs text-medora-slate">
                        Prescriber: <strong className="text-medora-navy">{rx.doctor_name}</strong>{" "}
                        · Hospital: <strong className="text-medora-navy">{rx.hospital_name}</strong>
                        {rx.pharmacy_name && (
                          <>
                            {" "}
                            · Pharmacy:{" "}
                            <strong className="text-medora-navy">{rx.pharmacy_name}</strong>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="text-right">
                      {rx.pricing_confirmed ? (
                        <div>
                          <p className="text-[11px] font-semibold uppercase text-medora-slate">
                            Pharmacy Confirmed Total
                          </p>
                          <p className="text-xl font-extrabold text-medora-navy">
                            {formatMoney(rx.total_amount_cents, rx.currency)}
                          </p>
                        </div>
                      ) : (
                        <span className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                          Awaiting pharmacy price confirmation
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Line Items */}
                  <div className="mt-4 overflow-x-auto">
                    <table className="table table-sm w-full text-xs">
                      <thead>
                        <tr className="text-medora-slate">
                          <th>Medicine</th>
                          <th>Dosage &amp; Instructions</th>
                          <th>Qty</th>
                          <th>Availability</th>
                          <th className="text-right">Confirmed Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rx.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <p className="font-bold text-medora-navy">
                                {item.medicine_name} {item.strength}
                              </p>
                              <p className="text-[11px] text-medora-slate">
                                {item.generic_name || item.dosage_form}
                              </p>
                            </td>
                            <td>
                              {item.dose} · {item.route} · {item.frequency} for {item.duration}
                              {item.instructions && (
                                <p className="text-[11px] text-medora-slate">{item.instructions}</p>
                              )}
                            </td>
                            <td>{item.quantity}</td>
                            <td>
                              <StatusBadge status={item.availability_status} />
                            </td>
                            <td className="text-right font-semibold">
                              {item.line_total_cents > 0
                                ? formatMoney(item.line_total_cents, rx.currency)
                                : "Pending"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {(rx.clinical_notes || rx.pharmacist_notes || rx.pickup_instructions) && (
                    <div className="mt-4 grid gap-3 rounded-xl bg-medora-mist p-4 text-xs sm:grid-cols-3">
                      {rx.clinical_notes && (
                        <div>
                          <p className="font-bold text-medora-navy">Doctor Notes</p>
                          <p className="mt-0.5 text-medora-slate">{rx.clinical_notes}</p>
                        </div>
                      )}
                      {rx.pharmacist_notes && (
                        <div>
                          <p className="font-bold text-medora-navy">Pharmacy Update</p>
                          <p className="mt-0.5 text-medora-slate">{rx.pharmacist_notes}</p>
                        </div>
                      )}
                      {rx.pickup_instructions && (
                        <div>
                          <p className="font-bold text-medora-navy">Pickup Instructions</p>
                          <p className="mt-0.5 text-medora-slate">{rx.pickup_instructions}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sandbox Payment Actions */}
                  {canPay && (
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-medora-border pt-4">
                      <p className="text-xs text-medora-slate">
                        Sandbox pilot checkout only — verified server-side via HMAC-SHA256 webhooks.
                      </p>
                      <div className="flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          onClick={() => initiatePayment(rx, "STRIPE_SANDBOX")}
                          className="medora-btn-primary py-2.5 text-xs"
                        >
                          <CreditCard className="h-4 w-4" /> Pay with Stripe Sandbox
                        </button>
                        <button
                          type="button"
                          onClick={() => initiatePayment(rx, "BKASH_SANDBOX")}
                          className="inline-flex items-center gap-2 rounded-xl bg-[#D12053] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#B21845]"
                        >
                          <Wallet className="h-4 w-4" /> Pay with bKash Sandbox
                        </button>
                      </div>
                    </div>
                  )}

                  {isPaid && rx.latest_payment && (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                      <strong>Payment Verified ({rx.latest_payment.provider}):</strong> Reference{" "}
                      <span className="font-mono font-bold">
                        {rx.latest_payment.provider_transaction_ref}
                      </span>{" "}
                      · Confirmed via signed server webhook.
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <form onSubmit={saveProfile} className="medora-card space-y-4 p-6 lg:col-span-7">
            <h2 className="text-lg font-bold text-medora-navy">Clinical &amp; Contact Profile</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold">Full Name</label>
                <input
                  value={profileForm.fullName}
                  onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })}
                  className="input input-bordered w-full bg-white text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">Phone Number</label>
                <input
                  value={profileForm.phone}
                  onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
                  className="input input-bordered w-full bg-white text-sm"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Address</label>
              <input
                value={profileForm.address}
                onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                className="input input-bordered w-full bg-white text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Known Allergies</label>
              <input
                value={profileForm.allergies}
                onChange={(e) => setProfileForm({ ...profileForm, allergies: e.target.value })}
                placeholder="e.g., Penicillin, Sulfa drugs"
                className="input input-bordered w-full bg-white text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold">Emergency Contact</label>
              <input
                value={profileForm.emergencyContact}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, emergencyContact: e.target.value })
                }
                className="input input-bordered w-full bg-white text-sm"
              />
            </div>
            <button type="submit" className="medora-btn-primary">
              Save Profile Changes
            </button>
          </form>

          <div className="space-y-6 lg:col-span-5">
            {/* Prescription Generator Code Card */}
            <div className="medora-card p-6">
              <div className="flex items-center gap-2 text-medora-teal">
                <KeyRound className="h-5 w-5" />
                <h2 className="text-base font-bold text-medora-navy">
                  Prescription Generator Code
                </h2>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-medora-slate">
                Your secret verification code is stored only as a salted cryptographic verifier and
                is never visible in logs or SMS. Rotate it anytime if misplaced.
              </p>
              <button
                type="button"
                onClick={handleRegenerateCode}
                className="medora-btn-outline mt-4 w-full text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Revoke &amp; Regenerate Code
              </button>
            </div>

            {/* One-Time Username Change & Strong Password Rotation */}
            <div className="medora-card space-y-4 p-6">
              <h2 className="text-base font-bold text-medora-navy">Account Security</h2>
              <div>
                <label className="mb-1 block text-xs font-semibold">
                  Current Password (Required for security actions)
                </label>
                <input
                  type="password"
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value)}
                  className="input input-bordered w-full bg-white text-sm"
                />
              </div>

              {!profile?.username_changed_at ? (
                <div className="rounded-xl border border-medora-border bg-medora-mist p-3.5">
                  <p className="text-xs font-bold text-medora-navy">
                    One-Time Username Change
                  </p>
                  <p className="text-[11px] text-medora-slate">
                    Your immutable ID ({profile?.patient_uid}) preserves all clinical records.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <input
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="new_username"
                      className="input input-bordered input-sm flex-1 bg-white"
                    />
                    <button
                      type="button"
                      onClick={handleUsernameChange}
                      className="medora-btn-primary py-1.5 text-xs"
                    >
                      Change
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-medora-slate">
                  One-time username change already used (@{profile.username}).
                </p>
              )}

              <div className="border-t border-medora-border pt-3">
                <label className="mb-1 block text-xs font-semibold">
                  Rotate Password (min 12 chars)
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New strong password"
                    className="input input-bordered input-sm flex-1 bg-white"
                  />
                  <button
                    type="button"
                    onClick={handlePasswordChange}
                    className="medora-btn-outline py-1.5 text-xs"
                  >
                    Update
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
