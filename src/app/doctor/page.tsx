"use client";

import { useEffect, useState, useCallback } from "react";
import Swal from "sweetalert2";
import {
  Building2,
  FilePlus2,
  KeyRound,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  XCircle,
} from "lucide-react";
import { PortalShell } from "@/components/PortalShell";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/client/api";

interface LookupPatient {
  patientId: string;
  patientUid: string;
  fullName: string;
  username: string;
  maskedPhone: string | null;
  phoneVerified: boolean;
  hasGeneratorCode: boolean;
}

interface VerifiedPatient {
  patientId: string;
  patientUid: string;
  fullName: string;
  allergies?: string | null;
  verificationMethod: "GENERATOR_CODE" | "OTP" | "NEW_PATIENT_PROVISION";
  verificationProof: string;
}

interface PharmacyOption {
  id: string;
  name: string;
  code: string;
  address: string | null;
  hospital_name: string;
  approved_pharmacists: Array<{ fullName: string; username: string }>;
}

interface RxRow {
  id: string;
  prescription_number: string;
  patient_name: string;
  patient_uid: string;
  pharmacy_name: string | null;
  status: string;
  pharmacist_notes: string | null;
  created_at: string;
  items: Array<{
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
  }>;
}

const EMPTY_ITEM = {
  medicineName: "",
  genericName: "",
  strength: "500mg",
  dosageForm: "Tablet",
  dose: "1 tablet",
  route: "Oral",
  frequency: "Twice daily after meals",
  duration: "7 days",
  quantity: 14,
  refills: 0,
  instructions: "",
};

export default function DoctorPortalPage() {
  const [prescriptions, setPrescriptions] = useState<RxRow[]>([]);
  const [pharmacies, setPharmacies] = useState<PharmacyOption[]>([]);
  const [pharmacyQuery, setPharmacyQuery] = useState("");
  const [selectedPharmacyId, setSelectedPharmacyId] = useState("");

  // Patient Lookup / Verify / Provision state
  const [lookupInput, setLookupInput] = useState("");
  const [foundPatient, setFoundPatient] = useState<LookupPatient | null>(null);
  const [verifyMethod, setVerifyMethod] = useState<"GENERATOR_CODE" | "OTP">("GENERATOR_CODE");
  const [verifyCode, setVerifyCode] = useState("");
  const [sandboxOtpHint, setSandboxOtpHint] = useState<string | null>(null);
  const [verifiedPatient, setVerifiedPatient] = useState<VerifiedPatient | null>(null);
  const [showProvision, setShowProvision] = useState(false);
  const [provisionForm, setProvisionForm] = useState({
    fullName: "",
    phone: "",
    dateOfBirth: "",
    address: "",
  });

  // Prescription Composer state
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const loadWorkspace = useCallback(async () => {
    const [rxRes, phRes] = await Promise.all([
      apiFetch<{ prescriptions: RxRow[] }>("/api/prescriptions"),
      apiFetch<{ pharmacies: PharmacyOption[] }>(
        `/api/pharmacies/resolve?q=${encodeURIComponent(pharmacyQuery)}`
      ),
    ]);
    if (rxRes.ok && rxRes.data.prescriptions) setPrescriptions(rxRes.data.prescriptions);
    if (phRes.ok && phRes.data.pharmacies) {
      setPharmacies(phRes.data.pharmacies);
      if (!selectedPharmacyId && phRes.data.pharmacies[0]) {
        setSelectedPharmacyId(phRes.data.pharmacies[0].id);
      }
    }
  }, [pharmacyQuery, selectedPharmacyId]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    setFoundPatient(null);
    setVerifiedPatient(null);
    setSandboxOtpHint(null);

    const res = await apiFetch<{ found: boolean; patient?: LookupPatient }>(
      "/api/doctor/patients/lookup",
      {
        method: "POST",
        body: JSON.stringify({ identifier: lookupInput }),
      }
    );
    if (!res.ok || !res.data.patient) {
      setShowProvision(true);
      Swal.fire({
        icon: "info",
        title: "Patient not found",
        text: res.data.error || res.data.message || "You can provision a new pending patient below.",
      });
      return;
    }
    setShowProvision(false);
    setFoundPatient(res.data.patient);
  }

  async function requestOtp() {
    if (!foundPatient) return;
    const res = await apiFetch<{ sandboxOtpPreview?: string }>("/api/doctor/patients/otp", {
      method: "POST",
      body: JSON.stringify({ patientId: foundPatient.patientId }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "OTP Verification Blocked", text: res.data.error });
      return;
    }
    setSandboxOtpHint(res.data.sandboxOtpPreview || null);
    Swal.fire({ icon: "success", title: "OTP Dispatched", text: res.data.message });
  }

  async function verifyIdentity() {
    if (!foundPatient) return;
    const res = await apiFetch<{
      verificationProof: string;
      patient: { patientId: string; patientUid: string; fullName: string; allergies?: string | null };
    }>("/api/doctor/patients/verify", {
      method: "POST",
      body: JSON.stringify({
        patientId: foundPatient.patientId,
        method: verifyMethod,
        code: verifyCode,
      }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Identity check failed", text: res.data.error });
      return;
    }
    setVerifiedPatient({
      ...res.data.patient,
      verificationMethod: verifyMethod,
      verificationProof: res.data.verificationProof,
    });
    setVerifyCode("");
    Swal.fire({
      icon: "success",
      title: "Patient Identity Verified",
      text: `${res.data.patient.fullName} (${res.data.patient.patientUid}) verified for prescribing.`,
      timer: 1800,
      showConfirmButton: false,
    });
  }

  async function handleProvision(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch<{
      patient: { patientId: string; patientUid: string; fullName: string };
      verificationProof: string;
      activationCode: string;
      activationPath: string;
    }>("/api/doctor/patients/provision", {
      method: "POST",
      body: JSON.stringify(provisionForm),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Provisioning failed", text: res.data.error });
      return;
    }
    setVerifiedPatient({
      ...res.data.patient,
      verificationMethod: "NEW_PATIENT_PROVISION",
      verificationProof: res.data.verificationProof,
    });
    setShowProvision(false);
    setProvisionForm({ fullName: "", phone: "", dateOfBirth: "", address: "" });

    await Swal.fire({
      icon: "success",
      title: "Pending Patient Provisioned",
      html: `<p style="font-size:13px;color:#526577">Share this one-time activation code with the patient (expires in 48 hours; patient sets their own password):</p><div style="margin:12px 0;padding:12px;background:#F3F8F8;border-radius:10px;font-family:monospace;font-size:18px;font-weight:800">${res.data.activationCode}</div><p style="font-size:12px">Activation path: <code>${res.data.activationPath}</code></p>`,
      confirmButtonColor: "#0B7A7E",
    });
  }

  async function handleIssuePrescription(e: React.FormEvent) {
    e.preventDefault();
    if (!verifiedPatient) {
      Swal.fire({ icon: "warning", title: "Confirm patient identity first" });
      return;
    }

    const chosenPharmacy = pharmacies.find((p) => p.id === selectedPharmacyId);
    const confirm = await Swal.fire({
      title: "Review & Sign Prescription",
      html: `<div style="text-align:left;font-size:13px">
        <p><strong>Patient:</strong> ${verifiedPatient.fullName} (${verifiedPatient.patientUid})</p>
        <p><strong>Items:</strong> ${items.length} medicine(s)</p>
        <p><strong>Verified Pharmacy:</strong> ${chosenPharmacy ? `${chosenPharmacy.name} (${chosenPharmacy.code})` : "Not routed yet"}</p>
        <p style="margin-top:8px;color:#526577">Issued prescriptions cannot be silently overwritten. Future changes create a traceable amendment.</p>
      </div>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Sign & Issue Prescription",
      confirmButtonColor: "#0B7A7E",
    });
    if (!confirm.isConfirmed) return;

    setBusy(true);
    const res = await apiFetch("/api/prescriptions", {
      method: "POST",
      body: JSON.stringify({
        patientId: verifiedPatient.patientId,
        pharmacyId: selectedPharmacyId || null,
        verificationMethod: verifiedPatient.verificationMethod,
        verificationProof: verifiedPatient.verificationProof,
        clinicalNotes,
        routeImmediately: Boolean(selectedPharmacyId),
        items,
      }),
    });
    setBusy(false);

    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Could not issue prescription", text: res.data.error });
      return;
    }

    Swal.fire({ icon: "success", title: "Prescription Issued", text: res.data.message });
    setItems([{ ...EMPTY_ITEM }]);
    setClinicalNotes("");
    loadWorkspace();
  }

  async function handleCancelRx(rx: RxRow) {
    const { value: reason } = await Swal.fire({
      title: `Cancel ${rx.prescription_number}`,
      input: "text",
      inputPlaceholder: "Clinical reason for cancellation (required)",
      showCancelButton: true,
      confirmButtonColor: "#B91C1C",
    });
    if (!reason) return;

    const res = await apiFetch(`/api/prescriptions/${rx.id}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "CANCEL", reason }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Cancel failed", text: res.data.error });
      return;
    }
    Swal.fire({ icon: "success", title: "Prescription Cancelled" });
    loadWorkspace();
  }

  return (
    <PortalShell
      title="Doctor Clinical Workspace"
      subtitle="Verify patient identity, compose structured prescriptions, and route to approved hospital pharmacies."
      onContextChanged={loadWorkspace}
    >
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: Patient Lookup, Identity Verification & Provisioning */}
        <section className="space-y-6 lg:col-span-5">
          <div className="medora-card p-6">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
                <Search className="h-4 w-4 text-medora-teal" /> 1. Patient Identity Verification
              </h2>
              <button
                type="button"
                onClick={() => setShowProvision((p) => !p)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-medora-teal hover:underline"
              >
                <UserPlus className="h-3.5 w-3.5" /> New patient
              </button>
            </div>

            <form onSubmit={handleLookup} className="mt-4 flex gap-2">
              <input
                required
                value={lookupInput}
                onChange={(e) => setLookupInput(e.target.value)}
                placeholder="Username, MED-PAT-..., or phone"
                className="input input-bordered input-sm flex-1 bg-white"
              />
              <button type="submit" className="medora-btn-primary py-1.5 text-xs">
                Lookup
              </button>
            </form>

            {foundPatient && !verifiedPatient && (
              <div className="mt-4 space-y-3 rounded-xl border border-medora-teal/30 bg-medora-teal-soft/30 p-4 text-xs">
                <div>
                  <p className="font-bold text-medora-navy">{foundPatient.fullName}</p>
                  <p className="text-medora-slate">
                    ID: <span className="font-mono">{foundPatient.patientUid}</span> · Phone:{" "}
                    {foundPatient.maskedPhone || "None"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVerifyMethod("GENERATOR_CODE")}
                    className={`rounded-lg border px-2 py-1.5 font-semibold ${
                      verifyMethod === "GENERATOR_CODE"
                        ? "border-medora-teal bg-medora-teal text-white"
                        : "border-medora-border bg-white text-medora-navy"
                    }`}
                  >
                    Generator Code
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerifyMethod("OTP")}
                    className={`rounded-lg border px-2 py-1.5 font-semibold ${
                      verifyMethod === "OTP"
                        ? "border-medora-teal bg-medora-teal text-white"
                        : "border-medora-border bg-white text-medora-navy"
                    }`}
                  >
                    Offline Patient OTP
                  </button>
                </div>

                {verifyMethod === "OTP" && (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={requestOtp}
                      className="medora-btn-outline w-full py-1.5 text-xs"
                    >
                      Send Single-Use 6-Digit OTP to Verified Phone
                    </button>
                    {sandboxOtpHint && (
                      <p className="rounded bg-amber-50 p-2 font-mono text-[11px] text-amber-900">
                        Sandbox OTP Preview: <strong>{sandboxOtpHint}</strong>
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                    placeholder={
                      verifyMethod === "GENERATOR_CODE" ? "MED-XXXX-XXXX" : "6-digit OTP"
                    }
                    className="input input-bordered input-sm flex-1 bg-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={verifyIdentity}
                    className="medora-btn-primary py-1.5 text-xs"
                  >
                    <KeyRound className="h-3.5 w-3.5" /> Confirm
                  </button>
                </div>
              </div>
            )}

            {verifiedPatient && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-bold">
                    <ShieldCheck className="h-4 w-4" /> Verified Patient Active
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setVerifiedPatient(null);
                      setFoundPatient(null);
                    }}
                    className="text-emerald-800 underline"
                  >
                    Switch
                  </button>
                </div>
                <p className="mt-1 font-bold">{verifiedPatient.fullName}</p>
                <p className="font-mono">{verifiedPatient.patientUid}</p>
                {verifiedPatient.allergies && (
                  <p className="mt-1.5 rounded bg-white/80 px-2 py-1 font-semibold text-red-700">
                    Allergies: {verifiedPatient.allergies}
                  </p>
                )}
              </div>
            )}

            {showProvision && (
              <form
                onSubmit={handleProvision}
                className="mt-4 space-y-3 rounded-xl border border-medora-border bg-medora-mist p-4"
              >
                <p className="text-xs font-bold text-medora-navy">
                  Provision Pending Patient (No Plaintext Password)
                </p>
                <input
                  required
                  value={provisionForm.fullName}
                  onChange={(e) => setProvisionForm({ ...provisionForm, fullName: e.target.value })}
                  placeholder="Patient full name *"
                  className="input input-bordered input-sm w-full bg-white"
                />
                <input
                  required
                  value={provisionForm.phone}
                  onChange={(e) => setProvisionForm({ ...provisionForm, phone: e.target.value })}
                  placeholder="Patient phone number *"
                  className="input input-bordered input-sm w-full bg-white"
                />
                <input
                  type="date"
                  value={provisionForm.dateOfBirth}
                  onChange={(e) =>
                    setProvisionForm({ ...provisionForm, dateOfBirth: e.target.value })
                  }
                  className="input input-bordered input-sm w-full bg-white"
                />
                <button type="submit" className="medora-btn-primary w-full py-2 text-xs">
                  Create Pending Identity &amp; Activation Code
                </button>
              </form>
            )}
          </div>

          {/* Pharmacy Resolution Card */}
          <div className="medora-card p-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
              <Building2 className="h-4 w-4 text-medora-teal" /> 2. Resolve Hospital Pharmacy
            </h2>
            <p className="mt-1 text-xs text-medora-slate">
              Search by pharmacy name, code, or pharmacist username/phone. Medora always confirms an
              approved hospital pharmacy before sending clinical data.
            </p>
            <input
              value={pharmacyQuery}
              onChange={(e) => setPharmacyQuery(e.target.value)}
              placeholder="Filter hospital pharmacies or pharmacist username..."
              className="input input-bordered input-sm mt-3 w-full bg-white"
            />
            <div className="mt-3 space-y-2">
              {pharmacies.map((ph) => (
                <label
                  key={ph.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-xs transition ${
                    selectedPharmacyId === ph.id
                      ? "border-medora-teal bg-medora-teal-soft/40"
                      : "border-medora-border bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="pharmacy"
                    checked={selectedPharmacyId === ph.id}
                    onChange={() => setSelectedPharmacyId(ph.id)}
                    className="radio radio-primary radio-xs mt-0.5"
                  />
                  <div>
                    <p className="font-bold text-medora-navy">
                      {ph.name} <span className="font-mono text-medora-teal">({ph.code})</span>
                    </p>
                    <p className="text-medora-slate">{ph.address || ph.hospital_name}</p>
                    {ph.approved_pharmacists.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-emerald-700">
                        Verified Staff:{" "}
                        {ph.approved_pharmacists.map((u) => u.fullName).join(", ")}
                      </p>
                    )}
                  </div>
                </label>
              ))}
              {pharmacies.length === 0 && (
                <p className="text-xs text-amber-700">
                  No active pharmacies found for your selected hospital context.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Right: Structured Prescription Composer + History */}
        <section className="space-y-6 lg:col-span-7">
          <form onSubmit={handleIssuePrescription} className="medora-card p-6">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
                <FilePlus2 className="h-4 w-4 text-medora-teal" /> 3. Compose &amp; Sign Prescription
              </h2>
              <button
                type="button"
                onClick={() => setItems([...items, { ...EMPTY_ITEM }])}
                className="inline-flex items-center gap-1 rounded-lg bg-medora-teal-soft px-2.5 py-1 text-xs font-bold text-medora-teal"
              >
                <Plus className="h-3.5 w-3.5" /> Add Medicine
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-medora-border bg-medora-mist/60 p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-medora-navy">Item #{idx + 1}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setItems(items.filter((_, i) => i !== idx))}
                        className="text-red-600 hover:text-red-800"
                        aria-label="Remove item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-3">
                    <input
                      required
                      value={item.medicineName}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], medicineName: e.target.value };
                        setItems(next);
                      }}
                      placeholder="Medicine name *"
                      className="input input-bordered input-sm bg-white"
                    />
                    <input
                      value={item.genericName}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], genericName: e.target.value };
                        setItems(next);
                      }}
                      placeholder="Generic ingredient"
                      className="input input-bordered input-sm bg-white"
                    />
                    <input
                      required
                      value={item.strength}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], strength: e.target.value };
                        setItems(next);
                      }}
                      placeholder="Strength (500mg) *"
                      className="input input-bordered input-sm bg-white"
                    />
                    <input
                      required
                      value={item.dosageForm}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], dosageForm: e.target.value };
                        setItems(next);
                      }}
                      placeholder="Form (Tablet/Capsule) *"
                      className="input input-bordered input-sm bg-white"
                    />
                    <input
                      required
                      value={item.dose}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], dose: e.target.value };
                        setItems(next);
                      }}
                      placeholder="Dose (1 tablet) *"
                      className="input input-bordered input-sm bg-white"
                    />
                    <input
                      required
                      value={item.route}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], route: e.target.value };
                        setItems(next);
                      }}
                      placeholder="Route (Oral) *"
                      className="input input-bordered input-sm bg-white"
                    />
                    <input
                      required
                      value={item.frequency}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], frequency: e.target.value };
                        setItems(next);
                      }}
                      placeholder="Frequency *"
                      className="input input-bordered input-sm bg-white"
                    />
                    <input
                      required
                      value={item.duration}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], duration: e.target.value };
                        setItems(next);
                      }}
                      placeholder="Duration (7 days) *"
                      className="input input-bordered input-sm bg-white"
                    />
                    <input
                      required
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], quantity: Number(e.target.value) };
                        setItems(next);
                      }}
                      placeholder="Quantity *"
                      className="input input-bordered input-sm bg-white"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-xs font-semibold text-medora-navy">
                Clinical Notes &amp; Counseling Instructions
              </label>
              <textarea
                rows={2}
                value={clinicalNotes}
                onChange={(e) => setClinicalNotes(e.target.value)}
                placeholder="Take after meals, complete full course..."
                className="textarea textarea-bordered w-full bg-white text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !verifiedPatient}
              className="medora-btn-primary mt-4 w-full"
            >
              <Send className="h-4 w-4" />
              {busy ? "Issuing..." : "Review, Sign & Route Prescription"}
            </button>
          </form>

          {/* Issued Prescriptions History */}
          <div className="medora-card p-6">
            <h2 className="text-base font-bold text-medora-navy">
              Recent Prescriptions in Active Hospital ({prescriptions.length})
            </h2>
            <div className="mt-4 space-y-3">
              {prescriptions.map((rx) => (
                <div
                  key={rx.id}
                  className="rounded-xl border border-medora-border p-4 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-medora-navy">
                        {rx.prescription_number}
                      </span>
                      <StatusBadge status={rx.status} />
                    </div>
                    {!["DISPENSED", "CANCELLED", "AMENDED"].includes(rx.status) && (
                      <button
                        type="button"
                        onClick={() => handleCancelRx(rx)}
                        className="inline-flex items-center gap-1 text-red-700 hover:underline"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Cancel
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-medora-slate">
                    Patient: <strong className="text-medora-navy">{rx.patient_name}</strong> (
                    {rx.patient_uid}) · Pharmacy: {rx.pharmacy_name || "Unrouted"}
                  </p>
                  {rx.pharmacist_notes && (
                    <p className="mt-1.5 rounded bg-amber-50 p-2 text-amber-900">
                      Pharmacy Note: {rx.pharmacist_notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </PortalShell>
  );
}
