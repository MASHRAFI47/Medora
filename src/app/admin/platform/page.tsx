"use client";

import { useEffect, useState, useCallback } from "react";
import Swal from "sweetalert2";
import { Building2, Plus, ShieldCheck } from "lucide-react";
import { PortalShell } from "@/components/PortalShell";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/client/api";

interface HospitalRow {
  id: string;
  name: string;
  slug: string;
  registration_code: string;
  status: string;
  pharmacy_count: number;
  approved_staff_count: number;
  prescription_count: number;
}

interface AuditRow {
  id: number;
  actor_username: string | null;
  actor_role: string | null;
  hospital_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: string;
  event_hash: string;
  created_at: string;
}

export default function PlatformAdminPage() {
  const [hospitals, setHospitals] = useState<HospitalRow[]>([]);
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    registrationCode: "",
    address: "",
    phone: "",
    email: "",
  });

  const loadAll = useCallback(async () => {
    const [hRes, aRes] = await Promise.all([
      apiFetch<{ hospitals: HospitalRow[] }>("/api/hospitals?all=true"),
      apiFetch<{ logs: AuditRow[] }>("/api/audit"),
    ]);
    if (hRes.ok && hRes.data.hospitals) setHospitals(hRes.data.hospitals);
    if (aRes.ok && aRes.data.logs) setLogs(aRes.data.logs);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function createHospital(e: React.FormEvent) {
    e.preventDefault();
    const res = await apiFetch("/api/hospitals", {
      method: "POST",
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Could not create tenant", text: res.data.error });
      return;
    }
    Swal.fire({ icon: "success", title: "Hospital tenant provisioned" });
    setForm({ name: "", slug: "", registrationCode: "", address: "", phone: "", email: "" });
    loadAll();
  }

  async function toggleStatus(h: HospitalRow) {
    const next = h.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const res = await apiFetch("/api/hospitals", {
      method: "PATCH",
      body: JSON.stringify({ hospitalId: h.id, status: next }),
    });
    if (res.ok) loadAll();
  }

  return (
    <PortalShell
      title="Platform Administration Console"
      subtitle="Provision isolated hospital tenants, control tenant status, and review global hash-chained audit events."
    >
      <div className="grid gap-6 lg:grid-cols-12">
        <form onSubmit={createHospital} className="medora-card space-y-3 p-6 lg:col-span-4">
          <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
            <Plus className="h-4 w-4 text-medora-teal" /> Provision Hospital Tenant
          </h2>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Hospital name *"
            className="input input-bordered input-sm w-full bg-white"
          />
          <input
            required
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
            placeholder="slug (e.g., metro-health) *"
            className="input input-bordered input-sm w-full bg-white font-mono"
          />
          <input
            required
            value={form.registrationCode}
            onChange={(e) => setForm({ ...form, registrationCode: e.target.value })}
            placeholder="Registration code (HSP-...) *"
            className="input input-bordered input-sm w-full bg-white font-mono"
          />
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Address"
            className="input input-bordered input-sm w-full bg-white"
          />
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Hospital contact email"
            className="input input-bordered input-sm w-full bg-white"
          />
          <button type="submit" className="medora-btn-primary w-full py-2 text-xs">
            Create Isolated Tenant
          </button>
        </form>

        <section className="medora-card p-6 lg:col-span-8">
          <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
            <Building2 className="h-4 w-4 text-medora-teal" /> Hospital Tenants ({hospitals.length})
          </h2>
          <div className="mt-4 space-y-3">
            {hospitals.map((h) => (
              <div
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-medora-border p-4 text-xs"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-medora-navy">{h.name}</span>
                    <span className="font-mono text-medora-teal">{h.registration_code}</span>
                    <StatusBadge status={h.status} />
                  </div>
                  <p className="mt-1 text-medora-slate">
                    Pharmacies: {h.pharmacy_count} · Verified Staff: {h.approved_staff_count} ·
                    Prescriptions: {h.prescription_count}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleStatus(h)}
                  className={
                    h.status === "ACTIVE"
                      ? "btn btn-outline btn-error btn-xs"
                      : "medora-btn-primary py-1.5 text-xs"
                  }
                >
                  {h.status === "ACTIVE" ? "Suspend Tenant" : "Reactivate Tenant"}
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="medora-card p-6 lg:col-span-12">
          <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
            <ShieldCheck className="h-4 w-4 text-medora-teal" /> Platform-Wide Hash-Chained Audit Log
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="table table-xs w-full">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Hospital</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Chain Hash</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td>{log.hospital_name || "Platform"}</td>
                    <td>
                      {log.actor_username || "system"} ({log.actor_role || "SYS"})
                    </td>
                    <td className="font-mono font-semibold">{log.action}</td>
                    <td>
                      {log.resource_type} {log.resource_id ? `· ${log.resource_id}` : ""}
                    </td>
                    <td className="font-mono text-[10px] text-medora-slate">
                      {log.event_hash.slice(0, 16)}…
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
