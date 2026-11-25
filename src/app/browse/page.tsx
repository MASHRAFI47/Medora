"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Building2, FlaskConical, Pill, Search } from "lucide-react";
import { MedoraLogo } from "@/components/MedoraLogo";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch, formatMoney } from "@/lib/client/api";

interface MedicineItem {
  id: string;
  display_name: string;
  strength: string;
  dosage_form: string;
  manufacturer: string | null;
  pack_size: string | null;
  unit_price_cents: number;
  currency: string;
  availability_status: string;
  generic_id: string;
  generic_name: string;
  drug_class: string | null;
  hospital_id: string;
  hospital_name: string;
  pharmacy_id: string;
  pharmacy_name: string;
  pharmacy_address: string | null;
}

interface GenericItem {
  id: string;
  name: string;
  drug_class: string | null;
  description: string | null;
  common_strengths: string | null;
  medicine_count: number;
}

export default function BrowseCatalogPage() {
  const [tab, setTab] = useState<"MEDICINES" | "GENERICS">("MEDICINES");
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState("");
  const [selectedGenericId, setSelectedGenericId] = useState("");
  const [medicines, setMedicines] = useState<MedicineItem[]>([]);
  const [generics, setGenerics] = useState<GenericItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const medParams = new URLSearchParams();
    if (search) medParams.set("q", search);
    if (availability) medParams.set("availability", availability);
    if (selectedGenericId) medParams.set("genericId", selectedGenericId);

    const genParams = new URLSearchParams();
    if (search) genParams.set("q", search);

    const [medRes, genRes] = await Promise.all([
      apiFetch<{ medicines: MedicineItem[] }>(`/api/catalog/medicines?${medParams.toString()}`),
      apiFetch<{ generics: GenericItem[] }>(`/api/catalog/generics?${genParams.toString()}`),
    ]);

    if (medRes.ok && medRes.data.medicines) setMedicines(medRes.data.medicines);
    if (genRes.ok && genRes.data.generics) setGenerics(genRes.data.generics);
    setLoading(false);
  }, [search, availability, selectedGenericId]);

  useEffect(() => {
    const t = setTimeout(() => {
      loadData();
    }, 200);
    return () => clearTimeout(t);
  }, [loadData]);

  return (
    <div className="min-h-screen bg-medora-mist">
      <header className="sticky top-0 z-20 border-b border-medora-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6">
          <MedoraLogo href="/" />
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-sm font-semibold text-medora-teal hover:underline">
              My Workspace
            </Link>
            <Link href="/auth/signin" className="medora-btn-primary py-2 text-xs">
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-medora-teal">
              PHARMACY CATALOG DIRECTORY
            </p>
            <h1 className="mt-1 text-3xl font-extrabold text-medora-navy">
              Browse Medicines &amp; Generics
            </h1>
            <p className="mt-1 text-sm text-medora-slate">
              Pharmacist-maintained availability across participating hospital pharmacies.
              Prescription items require doctor issuance and pharmacy confirmation before payment.
            </p>
          </div>

          <div className="inline-flex rounded-xl border border-medora-border bg-white p-1">
            <button
              type="button"
              onClick={() => setTab("MEDICINES")}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                tab === "MEDICINES"
                  ? "bg-medora-teal text-white"
                  : "text-medora-slate hover:text-medora-navy"
              }`}
            >
              <Pill className="h-4 w-4" /> Medicines ({medicines.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setTab("GENERICS");
                setSelectedGenericId("");
              }}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                tab === "GENERICS"
                  ? "bg-medora-teal text-white"
                  : "text-medora-slate hover:text-medora-navy"
              }`}
            >
              <FlaskConical className="h-4 w-4" /> Generics ({generics.length})
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="mt-6 grid gap-3 rounded-2xl border border-medora-border bg-white p-4 sm:grid-cols-12">
          <div className="relative sm:col-span-6">
            <Search className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-medora-slate" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                tab === "MEDICINES"
                  ? "Search brand name, generic active ingredient, or manufacturer..."
                  : "Search generic / active ingredient or drug class..."
              }
              className="input input-bordered w-full bg-white pl-10 text-sm"
            />
          </div>

          {tab === "MEDICINES" && (
            <>
              <div className="sm:col-span-3">
                <select
                  value={availability}
                  onChange={(e) => setAvailability(e.target.value)}
                  className="select select-bordered w-full bg-white text-sm"
                  aria-label="Filter by availability"
                >
                  <option value="">All availability</option>
                  <option value="IN_STOCK">In Stock</option>
                  <option value="LOW_STOCK">Low Stock</option>
                  <option value="OUT_OF_STOCK">Out of Stock</option>
                </select>
              </div>
              <div className="sm:col-span-3">
                <select
                  value={selectedGenericId}
                  onChange={(e) => setSelectedGenericId(e.target.value)}
                  className="select select-bordered w-full bg-white text-sm"
                  aria-label="Filter by generic ingredient"
                >
                  <option value="">All generics</option>
                  {generics.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {loading ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
        ) : tab === "MEDICINES" ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {medicines.length === 0 ? (
              <div className="medora-card col-span-full p-10 text-center text-sm text-medora-slate">
                No medicines match your filter.
              </div>
            ) : (
              medicines.map((m) => (
                <article key={m.id} className="medora-card flex flex-col justify-between p-5">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="text-base font-bold text-medora-navy">
                          {m.display_name}{" "}
                          <span className="font-semibold text-medora-teal">{m.strength}</span>
                        </h2>
                        <p className="text-xs font-medium text-medora-slate">
                          Generic: {m.generic_name} · {m.dosage_form}
                        </p>
                      </div>
                      <StatusBadge status={m.availability_status} />
                    </div>

                    <div className="mt-4 space-y-1 text-xs text-medora-slate">
                      {m.manufacturer && <p>Manufacturer: {m.manufacturer}</p>}
                      {m.pack_size && <p>Pack: {m.pack_size}</p>}
                    </div>
                  </div>

                  <div className="mt-5 border-t border-medora-border pt-3.5">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-extrabold text-medora-navy">
                        {formatMoney(m.unit_price_cents, m.currency)}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-medora-mist px-2.5 py-1 text-[11px] font-semibold text-medora-navy">
                        <Building2 className="h-3.5 w-3.5 text-medora-teal" />
                        {m.pharmacy_name}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-medora-slate">
                      Hospital: {m.hospital_name}
                    </p>
                  </div>
                </article>
              ))
            )}
          </div>
        ) : (
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {generics.map((g) => (
              <article key={g.id} className="medora-card flex flex-col justify-between p-5">
                <div>
                  <span className="rounded-full bg-medora-teal-soft px-2.5 py-0.5 text-[11px] font-bold text-medora-teal">
                    {g.drug_class || "Active Ingredient"}
                  </span>
                  <h2 className="mt-3 text-base font-bold text-medora-navy">{g.name}</h2>
                  {g.description && (
                    <p className="mt-1.5 text-xs leading-relaxed text-medora-slate">
                      {g.description}
                    </p>
                  )}
                  {g.common_strengths && (
                    <p className="mt-2 text-xs font-medium text-medora-navy">
                      Common strengths: {g.common_strengths}
                    </p>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-medora-border pt-3.5">
                  <span className="text-xs text-medora-slate">
                    {g.medicine_count} listed pharmacy products
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGenericId(g.id);
                      setTab("MEDICINES");
                    }}
                    className="text-xs font-bold text-medora-teal hover:underline"
                  >
                    View medicines →
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
