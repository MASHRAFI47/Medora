"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import Swal from "sweetalert2";
import {
  Bell,
  Building2,
  LogOut,
  Shield,
  ShieldCheck,
  Pill,
  CheckCheck,
  X,
} from "lucide-react";
import { MedoraLogo } from "@/components/MedoraLogo";
import { apiFetch } from "@/lib/client/api";

interface Membership {
  id: string;
  hospital_id: string;
  hospital_name: string;
  hospital_status: string;
  pharmacy_id: string | null;
  pharmacy_name: string | null;
  role: string;
  verification_status: string;
}

interface NotificationItem {
  id: string;
  category: string;
  title: string;
  body: string;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
}

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "Platform Admin",
  HOSPITAL_ADMIN: "Hospital Admin",
  DOCTOR: "Verified Doctor",
  PHARMACIST: "Pharmacist",
  PATIENT: "Patient",
};

export function PortalShell({
  title,
  subtitle,
  children,
  onContextChanged,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  onContextChanged?: () => void;
}) {
  const { data: session, update } = useSession();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotif, setShowNotif] = useState(false);
  const [showMfaModal, setShowMfaModal] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<{
    secret: string;
    qrDataUrl: string;
    instructions: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaPassword, setMfaPassword] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [mfaBusy, setMfaBusy] = useState(false);

  const loadContextAndNotifs = useCallback(async () => {
    const [ctxRes, notifRes] = await Promise.all([
      apiFetch<{ memberships: Membership[] }>("/api/auth/context"),
      apiFetch<{ notifications: NotificationItem[] }>("/api/notifications"),
    ]);
    if (ctxRes.ok && ctxRes.data.memberships) {
      setMemberships(ctxRes.data.memberships);
    }
    if (notifRes.ok && notifRes.data.notifications) {
      setNotifications(notifRes.data.notifications);
    }
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      loadContextAndNotifs();
    }
  }, [session?.user?.id, loadContextAndNotifs]);

  const approvedMemberships = memberships.filter(
    (m) => m.verification_status === "APPROVED" && m.hospital_status === "ACTIVE"
  );
  const activeMembership = approvedMemberships.find(
    (m) => m.hospital_id === session?.user?.activeHospitalId
  );
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function handleSwitchHospital(hospitalId: string) {
    const res = await apiFetch("/api/auth/context", {
      method: "POST",
      body: JSON.stringify({ hospitalId }),
    });
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Context switch blocked", text: res.data.error });
      return;
    }
    await update();
    await loadContextAndNotifs();
    onContextChanged?.();
    Swal.fire({
      icon: "success",
      title: "Hospital workspace switched",
      timer: 1500,
      showConfirmButton: false,
    });
  }

  async function markAllRead() {
    await apiFetch("/api/notifications", {
      method: "PATCH",
      body: JSON.stringify({ markAll: true }),
    });
    loadContextAndNotifs();
  }

  async function startMfaSetup() {
    setMfaBusy(true);
    const res = await apiFetch<{ secret: string; qrDataUrl: string; instructions: string }>(
      "/api/auth/mfa/setup",
      { method: "POST" }
    );
    setMfaBusy(false);
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "MFA setup error", text: res.data.error });
      return;
    }
    setMfaSetup(res.data);
  }

  async function submitMfaVerify(action: "ENABLE" | "DISABLE") {
    setMfaBusy(true);
    const res = await apiFetch<{ recoveryCodes?: string[] }>("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({
        action,
        totpCode: mfaCode,
        ...(action === "DISABLE" ? { currentPassword: mfaPassword } : {}),
      }),
    });
    setMfaBusy(false);
    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Verification failed", text: res.data.error });
      return;
    }
    await update();
    setMfaCode("");
    setMfaPassword("");
    if (res.data.recoveryCodes) {
      setRecoveryCodes(res.data.recoveryCodes);
      setMfaSetup(null);
    } else {
      setShowMfaModal(false);
      Swal.fire({ icon: "success", title: res.data.message || "MFA updated" });
    }
  }

  return (
    <div className="min-h-screen bg-medora-mist">
      <header className="sticky top-0 z-30 border-b border-medora-border bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <MedoraLogo href="/dashboard" />
            {session?.user?.role && (
              <span className="rounded-full border border-medora-teal/20 bg-medora-teal-soft px-3 py-1 text-xs font-semibold text-medora-teal">
                {ROLE_LABELS[session.user.role] || session.user.role}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Explicit Active Hospital & Pharmacy Context Selector for Multi-Hospital Staff */}
            {approvedMemberships.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-medora-border bg-medora-mist px-3 py-1.5 text-xs">
                <Building2 className="h-4 w-4 text-medora-teal" aria-hidden="true" />
                <label htmlFor="hospital-switcher" className="sr-only">
                  Active Hospital Workspace
                </label>
                <select
                  id="hospital-switcher"
                  value={session?.user?.activeHospitalId || ""}
                  onChange={(e) => handleSwitchHospital(e.target.value)}
                  className="bg-transparent font-semibold text-medora-navy focus:outline-none"
                >
                  {approvedMemberships.map((m) => (
                    <option key={m.id} value={m.hospital_id}>
                      {m.hospital_name}
                      {m.pharmacy_name ? ` — ${m.pharmacy_name}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {activeMembership?.pharmacy_name && (
              <span className="hidden items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 md:inline-flex">
                <Pill className="h-3.5 w-3.5" aria-hidden="true" />
                {activeMembership.pharmacy_name}
              </span>
            )}

            <Link
              href="/browse"
              className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-medora-slate hover:bg-medora-mist hover:text-medora-navy"
            >
              Browse Catalog
            </Link>

            <button
              type="button"
              onClick={() => {
                setRecoveryCodes(null);
                setShowMfaModal(true);
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                session?.user?.mfaEnabled
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-medora-border bg-white text-medora-slate hover:text-medora-navy"
              }`}
              title="Multi-Factor Authentication (TOTP)"
            >
              {session?.user?.mfaEnabled ? (
                <ShieldCheck className="h-3.5 w-3.5" />
              ) : (
                <Shield className="h-3.5 w-3.5" />
              )}
              <span>{session?.user?.mfaEnabled ? "MFA On" : "Setup MFA"}</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotif((prev) => !prev)}
                className="relative rounded-lg border border-medora-border bg-white p-2 text-medora-slate hover:text-medora-navy"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-medora-teal text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotif && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-medora-border bg-white p-4 shadow-float">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-medora-navy">Notifications</h3>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={markAllRead}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-medora-teal hover:underline"
                      >
                        <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                      </button>
                    )}
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="py-4 text-center text-xs text-medora-slate">
                        No notifications yet.
                      </p>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          className={`rounded-xl border p-2.5 text-xs ${
                            n.is_read
                              ? "border-slate-100 bg-white text-medora-slate"
                              : "border-medora-teal/25 bg-medora-teal-soft/40 text-medora-navy"
                          }`}
                        >
                          <p className="font-semibold">{n.title}</p>
                          <p className="mt-0.5 leading-relaxed">{n.body}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-medora-border bg-white px-3 py-1.5 text-xs font-semibold text-medora-navy hover:bg-red-50 hover:text-red-700"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-medora-navy sm:text-3xl">
              {title}
            </h1>
            <p className="mt-1 text-sm text-medora-slate">{subtitle}</p>
          </div>
          {session?.user && (
            <div className="text-right text-xs text-medora-slate">
              <p className="font-semibold text-medora-navy">{session.user.name}</p>
              <p>@{session.user.username}</p>
            </div>
          )}
        </div>

        {session?.user?.mustChangePassword && (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <strong>Security Reminder:</strong> This account is using an initial pilot password.
            Rotate your password and enable TOTP MFA before handling sensitive clinical records.
          </div>
        )}

        {children}
      </main>

      {/* TOTP MFA Configuration Modal */}
      {showMfaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-medora-navy/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-medora-border bg-white p-6 shadow-float">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-medora-navy">
                Multi-Factor Authentication (TOTP)
              </h2>
              <button
                type="button"
                onClick={() => setShowMfaModal(false)}
                className="rounded-lg p-1 text-medora-slate hover:bg-medora-mist"
                aria-label="Close MFA dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {recoveryCodes ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  <strong>MFA Enabled!</strong> Save these single-use recovery codes offline. They
                  will not be shown again.
                </div>
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-medora-border bg-medora-mist p-3 font-mono text-xs text-medora-navy">
                  {recoveryCodes.map((c) => (
                    <div key={c} className="rounded bg-white px-2 py-1 text-center">
                      {c}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowMfaModal(false)}
                  className="medora-btn-primary w-full"
                >
                  I have saved my recovery codes
                </button>
              </div>
            ) : session?.user?.mfaEnabled ? (
              <div className="space-y-4">
                <p className="text-sm text-medora-slate">
                  TOTP MFA is currently active on your account. To disable it, confirm both your
                  password and a current 6-digit authenticator code.
                </p>
                <input
                  type="password"
                  value={mfaPassword}
                  onChange={(e) => setMfaPassword(e.target.value)}
                  placeholder="Current password"
                  className="input input-bordered w-full bg-white text-sm"
                />
                <input
                  type="text"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="6-digit authenticator code"
                  className="input input-bordered w-full bg-white text-sm font-mono"
                />
                <button
                  type="button"
                  disabled={mfaBusy}
                  onClick={() => submitMfaVerify("DISABLE")}
                  className="btn btn-error w-full text-white"
                >
                  Disable MFA
                </button>
              </div>
            ) : mfaSetup ? (
              <div className="space-y-4">
                <p className="text-xs text-medora-slate">{mfaSetup.instructions}</p>
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={mfaSetup.qrDataUrl}
                    alt="Scan this TOTP QR code with your authenticator app"
                    className="h-48 w-48 rounded-xl border border-medora-border p-2"
                  />
                </div>
                <div className="rounded-xl bg-medora-mist p-2.5 text-center font-mono text-xs text-medora-navy">
                  Manual Key: {mfaSetup.secret}
                </div>
                <input
                  type="text"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="Enter 6-digit code from app"
                  className="input input-bordered w-full bg-white text-center font-mono text-base tracking-widest"
                />
                <button
                  type="button"
                  disabled={mfaBusy}
                  onClick={() => submitMfaVerify("ENABLE")}
                  className="medora-btn-primary w-full"
                >
                  Verify & Activate MFA
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-medora-slate">
                  Protect clinical and prescription access with time-based one-time passcodes (RFC
                  6238 TOTP) and encrypted single-use recovery codes.
                </p>
                <button
                  type="button"
                  disabled={mfaBusy}
                  onClick={startMfaSetup}
                  className="medora-btn-primary w-full"
                >
                  Generate Authenticator QR Code
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
