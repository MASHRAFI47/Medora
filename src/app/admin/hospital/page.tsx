"use client";

import { useEffect, useState, useCallback } from "react";
import Swal from "sweetalert2";
import { Building2, ShieldAlert, Users, Plus } from "lucide-react";
import { PortalShell } from "@/components/PortalShell";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/client/api";

interface StaffMembership {
  id: string;
  full_name: string;
  username: string;
  email: string;
  role: string;
  verification_status: string;
  pharmacy_id: string | null;
  pharmacy_name: string | null;
  license_number: string | null;
  issuing_jurisdiction: string | null;
  specialty: string | null;
}

interface PharmacyRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  status: string;
}

interface AuditRow {
  id: number;
  actor_username: string | null;
  actor_role: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: string;
  event_hash: string;
  created_at: string;
}

export default function HospitalAdminPage() {
  const [hospitalName, setHospitalName] = useState("Hospital Workspace");
  const [pharmacies, setPharmacies] = useState<PharmacyRow[]>([]);
  const [memberships, setMemberships] = useState<StaffMembership[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [pharmSelection, setPharmSelection] = useState<Record<string, string>>({});
  const [newPharmacy, setNewPharmacy] = useState({
    name: "",
    code: "",
    address: "",
    phone: "",
    pickupInstructions: "",
  });

  const loadAll = useCallback(async () => {
    const [hospRes, auditRes] = await Promise.all([
      apiFetch<{
        hospital: { name: string } | null;
        pharmacies: PharmacyRow[];
        memberships: StaffMembership[];
      }>("/api/admin/hospital"),
      apiFetch<{ logs: AuditRow[] }>("/api/audit"),
    ]);
    if (hospRes.ok) {
      if (hospRes.data.hospital) setHospitalName(hospRes.data.hospital.name);
      if (hospRes.data.pharmacies) setPharmacies(hospRes.data.pharmacies);
      if (hospRes.data.memberships) {
        setMemberships(hospRes.data.memberships);
        const map: Record<string, string> = {};
        for (const m of hospRes.data.memberships) {
          if (m.pharmacy_id) map[m.id] = m.pharmacy_id;
        }
        setPharmSelection(map);
      }
    }
    if (auditRes.ok && auditRes.data.logs) setAuditLogs(auditRes.data.logs);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function reviewStaff(
    m: StaffMembership,
    verificationStatus: "APPROVED" | "REJECTED" | "SUSPENDED"
  ) {
    const res = await apiFetch("/api/admin/hospital", {
      method: "PATCH",
      body: JSON.stringify({
        membershipId: m.id,
        verificationStatus,
        pharmacyId: m.role === "PHARMACIST" ? pharmSelection[m.id] || null : null,
      }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Action blocked", text: res.data.error });
      return;
    }
    Swal.fire({ icon: "success", title: res.data.message, timer: 1500, showConfirmButton: false });
    loadAll();
  }

  async function addPharmacy(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch("/api/admin/hospital", {
      method: "POST",
      body: JSON.stringify(newPharmacy),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Could not add pharmacy", text: res.data.error });
      return;
    }
    Swal.fire({ icon: "success", title: "Pharmacy associated with hospital" });
    setNewPharmacy({ name: "", code: "", address: "", phone: "", pickupInstructions: "" });
    loadAll();
  }

  return (
    <PortalShell
      title={`Hospital Admin — ${hospitalName}`}
      subtitle="Verify staff licenses, associate pharmacies, and review tenant-scoped audit events."
      onContextChanged={loadAll}
    >
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Staff Verification & Approvals */}
        <section className="medora-card p-6 lg:col-span-8">
          <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
            <Users className="h-4 w-4 text-medora-teal" /> Hospital Staff Memberships (
            {memberships.length})
          </h2>
          <div className="mt-4 space-y-3">
            {memberships.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-medora-border p-4 text-xs"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-medora-navy">{m.full_name}</span>
                    <span className="rounded bg-medora-mist px-2 py-0.5 font-semibold text-medora-teal">
                      {m.role}
                    </span>
                    <StatusBadge status={m.verification_status} />
                  </div>
                  <p className="mt-1 text-medora-slate">
                    License: <strong className="font-mono">{m.license_number || "N/A"}</strong> (
                    {m.issuing_jurisdiction || "TBD"}) · {m.specialty || m.email}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {m.role === "PHARMACIST" && (
                    <select
                      value={pharmSelection[m.id] || ""}
                      onChange={(e) =>
                        setPharmSelection({ ...pharmSelection, [m.id]: e.target.value })
                      }
                      className="select select-bordered select-xs bg-white"
                    >
                      <option value="">Assign Pharmacy</option>
                      {pharmacies.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {m.verification_status !== "APPROVED" && (
                    <button
                      type="button"
                      onClick={() => reviewStaff(m, "APPROVED")}
                      className="medora-btn-primary py-1.5 text-xs"
                    >
                      Approve
                    </button>
                  )}
                  {m.verification_status === "PENDING" && (
                    <button
                      type="button"
                      onClick={() => reviewStaff(m, "REJECTED")}
                      className="medora-btn-outline py-1.5 text-xs"
                    >
                      Reject
                    </button>
                  )}
                  {m.verification_status === "APPROVED" && m.role !== "HOSPITAL_ADMIN" && (
                    <button
                      type="button"
                      onClick={() => reviewStaff(m, "SUSPENDED")}
                      className="btn btn-error btn-xs text-white"
                    >
                      Suspend
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pharmacy Management */}
        <section className="medora-card p-6 lg:col-span-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
            <Building2 className="h-4 w-4 text-medora-teal" /> Associated Pharmacies (
            {pharmacies.length})
          </h2>
          <div className="mt-3 space-y-2">
            {pharmacies.map((p) => (
              <div key={p.id} className="rounded-xl border border-medora-border bg-medora-mist/50 p-3 text-xs">
                <p className="font-bold text-medora-navy">
                  {p.name} <span className="font-mono text-medora-teal">({p.code})</span>
                </p>
                <p className="text-medora-slate">{p.address}</p>
              </div>
            ))}
          </div>

          <form onSubmit={addPharmacy} className="mt-5 space-y-2.5 border-t border-medora-border pt-4">
            <p className="flex items-center gap-1 text-xs font-bold text-medora-navy">
              <Plus className="h-3.5 w-3.5 text-medora-teal" /> Add Pharmacy Location
            </p>
            <input
              required
              value={newPharmacy.name}
              onChange={(e) => setNewPharmacy({ ...newPharmacy, name: e.target.value })}
              placeholder="Pharmacy name *"
              className="input input-bordered input-sm w-full bg-white"
            />
            <input
              required
              value={newPharmacy.code}
              onChange={(e) => setNewPharmacy({ ...newPharmacy, code: e.target.value })}
              placeholder="Unique code (e.g., PHM-02) *"
              className="input input-bordered input-sm w-full bg-white"
            />
            <input
              value={newPharmacy.address}
              onChange={(e) => setNewPharmacy({ ...newPharmacy, address: e.target.value })}
              placeholder="Address / Wing"
              className="input input-bordered input-sm w-full bg-white"
            />
            <button type="submit" className="medora-btn-primary w-full py-2 text-xs">
              Associate Pharmacy
            </button>
          </form>
        </section>

        {/* Tenant-Scoped Audit Log */}
        <section className="medora-card p-6 lg:col-span-12">
          <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
            <ShieldAlert className="h-4 w-4 text-medora-teal" /> Scoped Tamper-Evident Audit Trail
          </h2>
          <p className="mt-1 text-xs text-medora-slate">
            PostgreSQL Row Level Security strictly limits this view to your active hospital tenant.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="table table-xs w-full">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Outcome</th>
                  <th>Chain Hash</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td>
                      {log.actor_username || "system"}{" "}
                      <span className="text-medora-slate">({log.actor_role || "SYS"})</span>
                    </td>
                    <td className="font-mono font-semibold">{log.action}</td>
                    <td>
                      {log.resource_type} {log.resource_id ? `· ${log.resource_id}` : ""}
                    </td>
                    <td>
                      <StatusBadge status={log.outcome === "SUCCESS" ? "ACTIVE" : "SUSPENDED"} />
                    </td>
                    <td className="font-mono text-[10px] text-medora-slate">
                      {log.event_hash.slice(0, 14)}…
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </PortalShell>
  );
}
