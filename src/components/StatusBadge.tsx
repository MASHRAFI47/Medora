"use client";

import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Package,
  ShieldCheck,
} from "lucide-react";

const STATUS_MAP: Record<
  string,
  { label: string; classes: string; icon: "check" | "clock" | "warn" | "error" | "pack" | "shield" }
> = {
  ACTIVE: { label: "Active", classes: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "check" },
  APPROVED: { label: "Approved", classes: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "shield" },
  PENDING: { label: "Pending Review", classes: "bg-amber-50 text-amber-800 border-amber-200", icon: "clock" },
  PENDING_APPROVAL: { label: "Pending Approval", classes: "bg-amber-50 text-amber-800 border-amber-200", icon: "clock" },
  PENDING_ACTIVATION: { label: "Awaiting Activation", classes: "bg-sky-50 text-sky-800 border-sky-200", icon: "clock" },
  SUSPENDED: { label: "Suspended", classes: "bg-red-50 text-red-800 border-red-200", icon: "error" },
  REJECTED: { label: "Rejected", classes: "bg-red-50 text-red-800 border-red-200", icon: "error" },
  DRAFT: { label: "Draft", classes: "bg-slate-100 text-slate-700 border-slate-200", icon: "clock" },
  ISSUED: { label: "Issued", classes: "bg-sky-50 text-sky-800 border-sky-200", icon: "shield" },
  SENT_TO_PHARMACY: { label: "Sent to Pharmacy", classes: "bg-teal-50 text-teal-800 border-teal-200", icon: "clock" },
  ACCEPTED: { label: "Confirmed by Pharmacy", classes: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "check" },
  CLARIFICATION_REQUESTED: { label: "Clarification Needed", classes: "bg-amber-50 text-amber-800 border-amber-200", icon: "warn" },
  PREPARING: { label: "Preparing Order", classes: "bg-indigo-50 text-indigo-800 border-indigo-200", icon: "pack" },
  READY_FOR_PICKUP: { label: "Ready for Pickup", classes: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "check" },
  DISPENSED: { label: "Dispensed", classes: "bg-slate-100 text-slate-800 border-slate-300", icon: "check" },
  REJECTED_UNAVAILABLE: { label: "Unavailable", classes: "bg-red-50 text-red-800 border-red-200", icon: "error" },
  CANCELLED: { label: "Cancelled", classes: "bg-red-50 text-red-800 border-red-200", icon: "error" },
  AMENDED: { label: "Amended (Superseded)", classes: "bg-slate-100 text-slate-700 border-slate-300", icon: "warn" },
  IN_STOCK: { label: "In Stock", classes: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "check" },
  LOW_STOCK: { label: "Low Stock", classes: "bg-amber-50 text-amber-800 border-amber-200", icon: "warn" },
  OUT_OF_STOCK: { label: "Out of Stock", classes: "bg-red-50 text-red-800 border-red-200", icon: "error" },
  INITIATED: { label: "Payment Initiated", classes: "bg-sky-50 text-sky-800 border-sky-200", icon: "clock" },
  SUCCEEDED: { label: "Paid (Verified)", classes: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "check" },
  FAILED: { label: "Payment Failed", classes: "bg-red-50 text-red-800 border-red-200", icon: "error" },
  REFUNDED: { label: "Refunded", classes: "bg-slate-100 text-slate-700 border-slate-300", icon: "warn" },
  AVAILABLE: { label: "Available", classes: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "check" },
  UNAVAILABLE: { label: "Unavailable", classes: "bg-red-50 text-red-800 border-red-200", icon: "error" },
  SUBSTITUTION_PROPOSED: { label: "Substitution Proposed", classes: "bg-amber-50 text-amber-800 border-amber-200", icon: "warn" },
};

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_MAP[status] || {
    label: status.replace(/_/g, " "),
    classes: "bg-slate-100 text-slate-700 border-slate-200",
    icon: "clock" as const,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.classes}`}
    >
      {cfg.icon === "check" && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
      {cfg.icon === "clock" && <Clock className="h-3.5 w-3.5" aria-hidden="true" />}
      {cfg.icon === "warn" && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
      {cfg.icon === "error" && <XCircle className="h-3.5 w-3.5" aria-hidden="true" />}
      {cfg.icon === "pack" && <Package className="h-3.5 w-3.5" aria-hidden="true" />}
      {cfg.icon === "shield" && <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
      <span>{cfg.label}</span>
    </span>
  );
}
