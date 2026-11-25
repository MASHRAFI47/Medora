"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Swal from "sweetalert2";
import { CheckCircle2, ShieldCheck, XCircle, AlertTriangle } from "lucide-react";
import { MedoraLogo } from "@/components/MedoraLogo";
import { apiFetch } from "@/lib/client/api";

export default function SandboxCheckoutPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const provider = (searchParams.get("provider") || "stripe_sandbox").toUpperCase();
  const sessionId = searchParams.get("session") || "";
  const [busy, setBusy] = useState(false);

  async function triggerSandboxWebhook(outcome: "SUCCEEDED" | "FAILED" | "CANCELLED") {
    setBusy(true);
    const res = await apiFetch("/api/payments/sandbox-confirm", {
      method: "POST",
      body: JSON.stringify({ paymentId, outcome }),
    });
    setBusy(false);

    if (!res.ok) {
      Swal.fire({ icon: "error", title: "Webhook verification failed", text: res.data.error });
      return;
    }

    await Swal.fire({
      icon: outcome === "SUCCEEDED" ? "success" : "info",
      title: `Sandbox Payment ${outcome}`,
      text: res.data.message,
      confirmButtonColor: "#0B7A7E",
    });
    router.push("/patient");
  }

  return (
    <div className="min-h-screen bg-medora-mist">
      <header className="border-b border-medora-border bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <MedoraLogo href="/patient" />
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 border border-amber-200">
            SANDBOX TEST MODE — NO LIVE CHARGE
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-12">
        <div className="medora-card p-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-medora-teal-soft px-3 py-1 text-xs font-bold text-medora-teal">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{provider.replace("_", " ")} CHECKOUT</span>
          </div>

          <h1 className="mt-4 text-2xl font-extrabold text-medora-navy">
            Complete Sandbox Payment
          </h1>
          <p className="mt-2 text-sm text-medora-slate">
            Medora never stores raw card or mobile wallet credentials and never trusts client-side
            redirects. Choosing an outcome below dispatches an HMAC-SHA256 signed server webhook
            with timestamp replay protection and idempotent reconciliation.
          </p>

          <div className="mt-5 rounded-xl border border-medora-border bg-medora-mist p-4 font-mono text-xs text-medora-navy">
            <p>Payment ID: {paymentId}</p>
            <p className="mt-1">Provider Session: {sessionId}</p>
          </div>

          <div className="mt-6 space-y-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => triggerSandboxWebhook("SUCCEEDED")}
              className="medora-btn-primary w-full"
            >
              <CheckCircle2 className="h-4 w-4" /> Simulate Verified Payment Success
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => triggerSandboxWebhook("FAILED")}
              className="btn btn-outline btn-error w-full"
            >
              <XCircle className="h-4 w-4" /> Simulate Payment Failure
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => triggerSandboxWebhook("CANCELLED")}
              className="medora-btn-outline w-full"
            >
              <AlertTriangle className="h-4 w-4" /> Cancel Checkout
            </button>
          </div>

          <div className="mt-6 text-center">
            <Link href="/patient" className="text-xs font-semibold text-medora-teal hover:underline">
              ← Return to Patient Portal
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
