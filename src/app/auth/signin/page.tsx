"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, Lock, ShieldCheck, KeyRound } from "lucide-react";
import { MedoraLogo } from "@/components/MedoraLogo";

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const isStaff = params.get("portal") === "staff";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [mfaPrompt, setMfaPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const res = await signIn("credentials", {
      identifier,
      password,
      totpCode: mfaPrompt ? totpCode : "",
      redirect: false,
    });

    setBusy(false);

    if (res?.error === "MFA_REQUIRED") {
      setMfaPrompt(true);
      setError("Multi-Factor Authentication is enabled. Enter your 6-digit authenticator or recovery code.");
      return;
    }

    if (res?.error) {
      setError(res.error);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col bg-medora-mist">
      <header className="border-b border-medora-border bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <MedoraLogo href="/" />
          <div className="flex items-center gap-4 text-sm">
            <Link href="/auth/register" className="font-semibold text-medora-teal hover:underline">
              Create patient account
            </Link>
            <Link
              href="/auth/register-staff"
              className="rounded-xl border border-medora-border px-3.5 py-2 font-semibold text-medora-navy hover:bg-medora-mist"
            >
              Staff registration
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
        <div className="medora-card p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-medora-teal-soft px-3 py-1 text-xs font-bold text-medora-teal">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{isStaff ? "HEALTHCARE TEAM ACCESS" : "SECURE SIGN IN"}</span>
          </div>

          <h1 className="mt-4 text-2xl font-extrabold text-medora-navy">
            {isStaff ? "Sign in to staff workspace" : "Sign in to Medora"}
          </h1>
          <p className="mt-1.5 text-sm text-medora-slate">
            Sessions use httpOnly cookies with rate-limited verification and optional TOTP MFA.
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
              <label htmlFor="identifier" className="mb-1 block text-xs font-semibold text-medora-navy">
                Email or Username
              </label>
              <input
                id="identifier"
                type="text"
                required
                autoComplete="username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="you@medora.health or username"
                className="input input-bordered w-full bg-white text-sm"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-semibold text-medora-navy">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="input input-bordered w-full bg-white text-sm"
              />
            </div>

            {mfaPrompt && (
              <div className="rounded-xl border border-medora-teal/30 bg-medora-teal-soft/40 p-4">
                <label
                  htmlFor="totpCode"
                  className="mb-1 flex items-center gap-1.5 text-xs font-bold text-medora-navy"
                >
                  <KeyRound className="h-3.5 w-3.5 text-medora-teal" />
                  Authenticator Code or Recovery Code
                </label>
                <input
                  id="totpCode"
                  type="text"
                  required
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="123456"
                  className="input input-bordered mt-1 w-full bg-white text-center font-mono text-base tracking-widest"
                />
              </div>
            )}

            <button type="submit" disabled={busy} className="medora-btn-primary w-full">
              <Lock className="h-4 w-4" />
              <span>{busy ? "Verifying..." : mfaPrompt ? "Verify & Sign in" : "Sign in"}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-6 space-y-2 border-t border-medora-border pt-5 text-xs text-medora-slate">
            <p>
              Have a one-time activation code from your doctor?{" "}
              <Link href="/activate" className="font-semibold text-medora-teal hover:underline">
                Activate patient account
              </Link>
            </p>
            <p>
              New patient?{" "}
              <Link href="/auth/register" className="font-semibold text-medora-teal hover:underline">
                Create patient account
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-medora-mist" />}>
      <SignInForm />
    </Suspense>
  );
}
