import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { withRlsContext } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import {
  signWebhookPayload,
  type PaymentProviderType,
} from "@/lib/payments/providers";
import { processVerifiedPaymentWebhook } from "@/lib/payments/webhook-processor";

const confirmSchema = z.object({
  paymentId: z.string().uuid(),
  outcome: z.enum(["SUCCEEDED", "FAILED", "CANCELLED"]),
});

/**
 * Pilot Sandbox Simulator:
 * Rather than trusting a client-side redirect, this endpoint signs a real HMAC-SHA256
 * provider webhook payload and executes the exact same server-side webhook verification
 * & idempotent processor used by Stripe and bKash callbacks.
 */
export async function POST(req: NextRequest) {
  serverEnv.paymentMode; // Enforces sandbox-only mode

  const auth = await requireApiAuth(req, { roles: ["PATIENT"] });
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => null);
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid sandbox confirmation request." }, { status: 400 });
  }

  const payment = await withRlsContext(auth.ctx.rls, async (client) => {
    const res = await client.query<{
      id: string;
      provider: PaymentProviderType;
      provider_session_id: string;
    }>(
      `SELECT pay.id, pay.provider, pay.provider_session_id
       FROM payments pay
       JOIN patients p ON p.id = pay.patient_id
       WHERE pay.id = $1 AND p.user_id = $2
       LIMIT 1`,
      [parsed.data.paymentId, auth.ctx.userId]
    );
    return res.rows[0] ?? null;
  });

  if (!payment) {
    return NextResponse.json({ error: "Payment record not found." }, { status: 404 });
  }

  const eventPayload = JSON.stringify({
    eventId: `evt_sbx_${crypto.randomBytes(10).toString("hex")}`,
    eventType: `payment.${parsed.data.outcome.toLowerCase()}`,
    providerSessionId: payment.provider_session_id,
    status: parsed.data.outcome,
    transactionRef: `TXN_${payment.provider === "BKASH_SANDBOX" ? "BK" : "ST"}_${crypto
      .randomBytes(5)
      .toString("hex")
      .toUpperCase()}`,
  });

  const signature = signWebhookPayload(payment.provider, eventPayload);

  const processed = await processVerifiedPaymentWebhook({
    provider: payment.provider,
    rawBody: eventPayload,
    signatureHeader: signature,
  });

  if (!processed.ok) {
    return NextResponse.json({ error: processed.error }, { status: processed.status });
  }

  return NextResponse.json({
    message: `Sandbox ${payment.provider} webhook verified and recorded (${parsed.data.outcome}).`,
    status: parsed.data.outcome,
    verifiedViaWebhook: true,
  });
}
