"use client";

import { useEffect, useState, useCallback } from "react";
import Swal from "sweetalert2";
import { ClipboardList, Pill, Plus, Upload } from "lucide-react";
import { PortalShell } from "@/components/PortalShell";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch, formatMoney } from "@/lib/client/api";

interface RxItem {
  id: string;
  medicine_name: string;
  strength: string;
  dosage_form: string;
  quantity: number;
  availability_status: string;
  confirmed_unit_price_cents: number;
  line_total_cents: number;
}

interface InboxRx {
  id: string;
  prescription_number: string;
  patient_name: string;
  patient_uid: string;
  doctor_name: string;
  status: string;
  pricing_confirmed: boolean;
  total_amount_cents: number;
  currency: string;
  pharmacist_notes: string | null;
  pickup_instructions: string | null;
  items: RxItem[];
  latest_payment: { status: string; provider: string } | null;
}

interface CatalogMed {
  id: string;
  display_name: string;
  strength: string;
  dosage_form: string;
  generic_name: string;
  unit_price_cents: number;
  currency: string;
  availability_status: string;
}

interface GenericRow {
  id: string;
  name: string;
}

export default function PharmacistPortalPage() {
  const [tab, setTab] = useState<"INBOX" | "CATALOG">("INBOX");
  const [inbox, setInbox] = useState<InboxRx[]>([]);
  const [catalog, setCatalog] = useState<CatalogMed[]>([]);
  const [generics, setGenerics] = useState<GenericRow[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, number>>({});
  const [availDrafts, setAvailDrafts] = useState<Record<string, string>>({});

  const [newMed, setNewMed] = useState({
    genericId: "",
    displayName: "",
    strength: "",
    dosageForm: "Tablet",
    manufacturer: "",
    packSize: "10 tablets/strip",
    unitPriceTaka: "50",
    availabilityStatus: "IN_STOCK" as "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK",
    imageUploadId: "",
  });

  const loadAll = useCallback(async () => {
    const [rxRes, medRes, genRes] = await Promise.all([
      apiFetch<{ prescriptions: InboxRx[] }>("/api/prescriptions"),
      apiFetch<{ medicines: CatalogMed[] }>("/api/catalog/medicines?mine=true"),
      apiFetch<{ generics: GenericRow[] }>("/api/catalog/generics"),
    ]);
    if (rxRes.ok && rxRes.data.prescriptions) {
      setInbox(rxRes.data.prescriptions);
      const prices: Record<string, number> = {};
      const avails: Record<string, string> = {};
      for (const rx of rxRes.data.prescriptions) {
        for (const it of rx.items) {
          prices[it.id] = it.confirmed_unit_price_cents || 5000;
          avails[it.id] = it.availability_status === "PENDING" ? "AVAILABLE" : it.availability_status;
        }
      }
      setPriceDrafts(prices);
      setAvailDrafts(avails);
    }
    if (medRes.ok && medRes.data.medicines) setCatalog(medRes.data.medicines);
    if (genRes.ok && genRes.data.generics) setGenerics(genRes.data.generics);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function updateFulfillment(
    rx: InboxRx,
    nextStatus:
      | "ACCEPTED"
      | "CLARIFICATION_REQUESTED"
      | "PREPARING"
      | "READY_FOR_PICKUP"
      | "DISPENSED"
      | "REJECTED_UNAVAILABLE"
  ) {
    let notes: string | undefined;
    let pickup: string | undefined;

    if (nextStatus === "CLARIFICATION_REQUESTED" || nextStatus === "REJECTED_UNAVAILABLE") {
      const { value } = await Swal.fire({
        title: `Update ${rx.prescription_number}`,
        input: "text",
        inputPlaceholder: "Provide clear note for doctor & patient",
        showCancelButton: true,
        confirmButtonColor: "#0B7A7E",
      });
      if (!value) return;
      notes = value;
    } else if (nextStatus === "READY_FOR_PICKUP") {
      const { value } = await Swal.fire({
        title: "Confirm Pickup Instructions",
        input: "text",
        inputValue: rx.pickup_instructions || "Collect at Pharmacy Counter 2 with RX number and ID.",
        showCancelButton: true,
        confirmButtonColor: "#0B7A7E",
      });
      if (value === undefined) return;
      pickup = value;
    }

    const itemUpdates = rx.items.map((it) => ({
      itemId: it.id,
      availabilityStatus: availDrafts[it.id] || "AVAILABLE",
      confirmedUnitPriceCents: Number(priceDrafts[it.id] ?? it.confirmed_unit_price_cents ?? 0),
    }));

    const res = await apiFetch(`/api/prescriptions/${rx.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: nextStatus,
        pharmacistNotes: notes,
        pickupInstructions: pickup,
        itemUpdates,
      }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Update blocked", text: res.data.error });
      return;
    }
    Swal.fire({ icon: "success", title: res.data.message, timer: 1600, showConfirmButton: false });
    loadAll();
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("purpose", "CATALOG_IMAGE");
    const res = await apiFetch<{ uploadId: string }>("/api/uploads", {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Upload rejected", text: res.data.error });
      return;
    }
    setNewMed((prev) => ({ ...prev, imageUploadId: res.data.uploadId }));
    Swal.fire({ icon: "success", title: "Image validated & uploaded", timer: 1400, showConfirmButton: false });
  }

  async function handleAddMedicine(e: React.FormEvent) {
    e.preventDefault();
    const cents = Math.round(Number(newMed.unitPriceTaka) * 100);
    const res = await apiFetch("/api/catalog/medicines", {
      method: "POST",
      body: JSON.stringify({
        genericId: newMed.genericId,
        displayName: newMed.displayName,
        strength: newMed.strength,
        dosageForm: newMed.dosageForm,
        manufacturer: newMed.manufacturer,
        packSize: newMed.packSize,
        unitPriceCents: cents,
        availabilityStatus: newMed.availabilityStatus,
        imageUploadId: newMed.imageUploadId || null,
      }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Could not add medicine", text: res.data.error });
      return;
    }
    Swal.fire({ icon: "success", title: "Medicine added to catalog" });
    setNewMed({ ...newMed, displayName: "", strength: "", imageUploadId: "" });
    loadAll();
  }

  async function toggleStock(med: CatalogMed, availabilityStatus: string) {
    const res = await apiFetch("/api/catalog/medicines", {
      method: "PATCH",
      body: JSON.stringify({ id: med.id, availabilityStatus }),
    });
    if (res.ok) loadAll();
  }

  return (
    <PortalShell
      title="Pharmacy Operations Workspace"
      subtitle="Confirm routed prescription availability & pricing, advance fulfillment, and maintain pharmacy catalog."
      onContextChanged={loadAll}
    >
      <div className="mb-6 inline-flex rounded-xl border border-medora-border bg-white p-1">
        <button
          type="button"
          onClick={() => setTab("INBOX")}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "INBOX" ? "bg-medora-teal text-white" : "text-medora-slate"
          }`}
        >
          <ClipboardList className="h-4 w-4" /> Prescription Inbox ({inbox.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("CATALOG")}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "CATALOG" ? "bg-medora-teal text-white" : "text-medora-slate"
          }`}
        >
          <Pill className="h-4 w-4" /> Pharmacy Catalog ({catalog.length})
        </button>
      </div>

      {tab === "INBOX" ? (
        <div className="space-y-5">
          {inbox.length === 0 ? (
            <div className="medora-card p-10 text-center text-sm text-medora-slate">
              No prescriptions routed to your active pharmacy yet.
            </div>
          ) : (
            inbox.map((rx) => (
              <article key={rx.id} className="medora-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-medora-border pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-mono text-base font-extrabold text-medora-navy">
                        {rx.prescription_number}
                      </h2>
                      <StatusBadge status={rx.status} />
                      {rx.latest_payment && <StatusBadge status={rx.latest_payment.status} />}
                    </div>
                    <p className="mt-1 text-xs text-medora-slate">
                      Patient: <strong className="text-medora-navy">{rx.patient_name}</strong> (
                      {rx.patient_uid}) · Prescriber: {rx.doctor_name}
                    </p>
                  </div>
                  <div className="text-right text-sm font-extrabold text-medora-navy">
                    {formatMoney(rx.total_amount_cents, rx.currency)}
                  </div>
                </div>

                <div className="mt-4 space-y-2.5">
                  {rx.items.map((it) => (
                    <div
                      key={it.id}
                      className="grid items-center gap-3 rounded-xl border border-medora-border bg-medora-mist/50 p-3 text-xs sm:grid-cols-12"
                    >
                      <div className="sm:col-span-5">
                        <p className="font-bold text-medora-navy">
                          {it.medicine_name} {it.strength} ({it.dosage_form})
                        </p>
                        <p className="text-medora-slate">Quantity prescribed: {it.quantity}</p>
                      </div>
                      <div className="sm:col-span-3">
                        <select
                          value={availDrafts[it.id] || "AVAILABLE"}
                          onChange={(e) =>
                            setAvailDrafts({ ...availDrafts, [it.id]: e.target.value })
                          }
                          className="select select-bordered select-xs w-full bg-white"
                        >
                          <option value="AVAILABLE">Available</option>
                          <option value="UNAVAILABLE">Unavailable</option>
                          <option value="SUBSTITUTION_PROPOSED">Substitution Proposed</option>
                        </select>
                      </div>
                      <div className="sm:col-span-4">
                        <label className="text-[11px] text-medora-slate">Unit Price (cents):</label>
                        <input
                          type="number"
                          min={0}
                          value={priceDrafts[it.id] ?? 0}
                          onChange={(e) =>
                            setPriceDrafts({ ...priceDrafts, [it.id]: Number(e.target.value) })
                          }
                          className="input input-bordered input-xs ml-2 w-28 bg-white font-mono"
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-medora-border pt-4">
                  {["SENT_TO_PHARMACY", "CLARIFICATION_REQUESTED"].includes(rx.status) && (
                    <>
                      <button
                        type="button"
                        onClick={() => updateFulfillment(rx, "ACCEPTED")}
                        className="medora-btn-primary py-2 text-xs"
                      >
                        Accept &amp; Confirm Price
                      </button>
                      <button
                        type="button"
                        onClick={() => updateFulfillment(rx, "CLARIFICATION_REQUESTED")}
                        className="medora-btn-outline py-2 text-xs"
                      >
                        Request Doctor Clarification
                      </button>
                      <button
                        type="button"
                        onClick={() => updateFulfillment(rx, "REJECTED_UNAVAILABLE")}
                        className="btn btn-error btn-sm text-xs text-white"
                      >
                        Mark Unavailable
                      </button>
                    </>
                  )}
                  {rx.status === "ACCEPTED" && (
                    <button
                      type="button"
                      onClick={() => updateFulfillment(rx, "PREPARING")}
                      className="medora-btn-primary py-2 text-xs"
                    >
                      Start Preparing Order
                    </button>
                  )}
                  {["ACCEPTED", "PREPARING"].includes(rx.status) && (
                    <button
                      type="button"
                      onClick={() => updateFulfillment(rx, "READY_FOR_PICKUP")}
                      className="medora-btn-outline py-2 text-xs"
                    >
                      Mark Ready for Pickup
                    </button>
                  )}
                  {["PREPARING", "READY_FOR_PICKUP"].includes(rx.status) && (
                    <button
                      type="button"
                      onClick={() => updateFulfillment(rx, "DISPENSED")}
                      className="btn btn-success btn-sm text-xs text-white"
                    >
                      Record Dispensed
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          <form onSubmit={handleAddMedicine} className="medora-card space-y-3 p-6 lg:col-span-4">
            <h2 className="flex items-center gap-2 text-base font-bold text-medora-navy">
              <Plus className="h-4 w-4 text-medora-teal" /> Add Pharmacy Product
            </h2>
            <select
              required
              value={newMed.genericId}
              onChange={(e) => setNewMed({ ...newMed, genericId: e.target.value })}
              className="select select-bordered select-sm w-full bg-white"
            >
              <option value="">Select active generic *</option>
              {generics.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <input
              required
              value={newMed.displayName}
              onChange={(e) => setNewMed({ ...newMed, displayName: e.target.value })}
              placeholder="Brand display name *"
              className="input input-bordered input-sm w-full bg-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                required
                value={newMed.strength}
                onChange={(e) => setNewMed({ ...newMed, strength: e.target.value })}
                placeholder="Strength *"
                className="input input-bordered input-sm bg-white"
              />
              <input
                required
                value={newMed.dosageForm}
                onChange={(e) => setNewMed({ ...newMed, dosageForm: e.target.value })}
                placeholder="Dosage form *"
                className="input input-bordered input-sm bg-white"
              />
            </div>
            <input
              value={newMed.manufacturer}
              onChange={(e) => setNewMed({ ...newMed, manufacturer: e.target.value })}
              placeholder="Manufacturer"
              className="input input-bordered input-sm w-full bg-white"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                required
                type="number"
                step="0.5"
                value={newMed.unitPriceTaka}
                onChange={(e) => setNewMed({ ...newMed, unitPriceTaka: e.target.value })}
                placeholder="Price (BDT) *"
                className="input input-bordered input-sm bg-white"
              />
              <select
                value={newMed.availabilityStatus}
                onChange={(e) =>
                  setNewMed({
                    ...newMed,
                    availabilityStatus: e.target.value as "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK",
                  })
                }
                className="select select-bordered select-sm bg-white"
              >
                <option value="IN_STOCK">In Stock</option>
                <option value="LOW_STOCK">Low Stock</option>
                <option value="OUT_OF_STOCK">Out of Stock</option>
              </select>
            </div>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-medora-border bg-medora-mist p-2.5 text-xs font-semibold text-medora-slate hover:border-medora-teal">
              <Upload className="h-3.5 w-3.5" />
              <span>
                {newMed.imageUploadId ? "Validated image attached ✓" : "Upload package image (PNG/JPG/WebP ≤2MB)"}
              </span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageUpload} className="hidden" />
            </label>
            <button type="submit" className="medora-btn-primary w-full py-2 text-xs">
              Add to Active Pharmacy Catalog
            </button>
          </form>

          <div className="medora-card p-6 lg:col-span-8">
            <h2 className="text-base font-bold text-medora-navy">Active Pharmacy Inventory</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="table table-sm w-full text-xs">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Generic</th>
                    <th>Price</th>
                    <th>Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((m) => (
                    <tr key={m.id}>
                      <td className="font-bold text-medora-navy">
                        {m.display_name} {m.strength}
                      </td>
                      <td>{m.generic_name}</td>
                      <td className="font-mono">{formatMoney(m.unit_price_cents, m.currency)}</td>
                      <td>
                        <select
                          value={m.availability_status}
                          onChange={(e) => toggleStock(m, e.target.value)}
                          className="select select-bordered select-xs bg-white"
                        >
                          <option value="IN_STOCK">In Stock</option>
                          <option value="LOW_STOCK">Low Stock</option>
                          <option value="OUT_OF_STOCK">Out of Stock</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
