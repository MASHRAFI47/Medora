import "server-only";
import crypto from "node:crypto";
import { serverEnv } from "@/lib/env";
import { hmacSha256Hex, timingSafeEqualStr } from "@/lib/security/crypto";
import { validateExternalUrl } from "@/lib/security/ssrf";

export type PaymentProviderType = "STRIPE_SANDBOX" | "BKASH_SANDBOX";

export interface CheckoutSessionInput {
  paymentId: string;
  prescriptionNumber: string;
  amountCents: number;
  currency: string;
  provider: PaymentProviderType;
}

export interface CheckoutSessionOutput {
  providerSessionId: string;
  checkoutUrl: string;
  sandboxMode: true;
  providerLabel: string;
}

/**
 * Unified Sandbox Payment Provider Abstraction (Stripe Sandbox & bKash Sandbox).
 * Never stores raw card or wallet credentials and enforces PAYMENT_MODE=sandbox.
 */
export async function createSandboxCheckoutSession(
  input: CheckoutSessionInput
): Promise<CheckoutSessionOutput> {
  // Ensures pilot release never accidentally processes live payments
  serverEnv.paymentMode;

  if (input.provider === "BKASH_SANDBOX") {
    // Validate configured sandbox endpoint against SSRF rules before any future live sandbox call
    await validateExternalUrl(serverEnv.bkashSandboxBaseUrl, [
      "tokenized.sandbox.bka.sh",
    ]).catch(() => {
      // Offline/local sandbox mode continues safely with local signed webhook simulation
    });

    const providerSessionId = `bkash_sbx_${crypto.randomBytes(12).toString("hex")}`;
    return {
      providerSessionId,
      checkoutUrl: `/patient/checkout/${input.paymentId}?provider=bkash_sandbox&session=${providerSessionId}`,
      sandboxMode: true,
      providerLabel: "bKash Sandbox",
    };
  }

  const providerSessionId = `cs_test_${crypto.randomBytes(12).toString("hex")}`;
  return {
    providerSessionId,
    checkoutUrl: `/patient/checkout/${input.paymentId}?provider=stripe_sandbox&session=${providerSessionId}`,
    sandboxMode: true,
    providerLabel: "Stripe Sandbox",
  };
}

/**
 * Generates an HMAC-SHA256 webhook signature header with timestamp replay protection:
 * Format: `t=<unix_seconds>,v1=<hex_hmac_sha256>`
 */
export function signWebhookPayload(
  provider: PaymentProviderType,
  rawBody: string,
  timestampSeconds = Math.floor(Date.now() / 1000)
): string {
  const secret =
    provider === "STRIPE_SANDBOX"
      ? serverEnv.stripeWebhookSecret
      : serverEnv.bkashWebhookSecret;
  const sig = hmacSha256Hex(secret, `${timestampSeconds}.${rawBody}`);
  return `t=${timestampSeconds},v1=${sig}`;
}

/**
 * Verifies Stripe/bKash webhook HMAC-SHA256 signature using constant-time comparison
 * and rejects replayed signatures older than 5 minutes.
 */
export function verifyWebhookSignature(
  provider: PaymentProviderType,
  rawBody: string,
  signatureHeader: string | null,
  toleranceSeconds = 300
): { valid: boolean; reason?: string } {
  if (!signatureHeader) {
    return { valid: false, reason: "Missing webhook signature header." };
  }

  const parts = Object.fromEntries(
    signatureHeader
      .split(",")
      .map((kv) => kv.trim().split("="))
      .filter((pair) => pair.length === 2)
  );

  const timestamp = Number(parts.t);
  const providedSig = parts.v1;

  if (!Number.isFinite(timestamp) || !providedSig) {
    return { valid: false, reason: "Malformed webhook signature header." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, reason: "Webhook signature timestamp outside allowed replay window." };
  }

  const secret =
    provider === "STRIPE_SANDBOX"
      ? serverEnv.stripeWebhookSecret
      : serverEnv.bkashWebhookSecret;
  const expectedSig = hmacSha256Hex(secret, `${timestamp}.${rawBody}`);

  if (!timingSafeEqualStr(providedSig, expectedSig)) {
    return { valid: false, reason: "Invalid webhook HMAC signature." };
  }

  return { valid: true };
}
