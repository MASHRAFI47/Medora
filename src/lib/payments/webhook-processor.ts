import "server-only";
import { z } from "zod";
import { withRlsContext } from "@/lib/db";
import {
  verifyWebhookSignature,
  type PaymentProviderType,
} from "@/lib/payments/providers";
import { recordAuditEvent } from "@/lib/security/audit";

const webhookPayloadSchema = z.object({
  eventId: z.string().min(6).max(120),
  eventType: z.string().min(3).max(80),
  providerSessionId: z.string().min(6).max(160),
  status: z.enum(["SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED"]),
  transactionRef: z.string().min(4).max(120).optional(),
});

export async function processVerifiedPaymentWebhook(params: {
  provider: PaymentProviderType;
  rawBody: string;
  signatureHeader: string | null;
}): Promise<{ ok: true; duplicate: boolean } | { ok: false; status: number; error: string }> {
  // 1. Constant-time HMAC-SHA256 + timestamp replay window verification
  const sigCheck = verifyWebhookSignature(
    params.provider,
    params.rawBody,
    params.signatureHeader
  );
  if (!sigCheck.valid) {
    await recordAuditEvent({
      action: "WEBHOOK_SIGNATURE_REJECTED",
      resourceType: "PAYMENT_WEBHOOK",
      resourceId: params.provider,
      outcome: "DENIED",
      metadata: { reason: sigCheck.reason },
    });
    return { ok: false, status: 401, error: sigCheck.reason || "Invalid webhook signature." };
  }

  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(params.rawBody);
  } catch {
    return { ok: false, status: 400, error: "Malformed webhook JSON payload." };
  }

  const parsed = webhookPayloadSchema.safeParse(jsonBody);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "Invalid webhook payload schema." };
  }

  const evt = parsed.data;

  const outcome = await withRlsContext({ bypassRls: true }, async (client) => {
    // 2. Idempotent webhook deduplication via UNIQUE(provider, provider_event_id)
    const inserted = await client.query(
      `INSERT INTO webhook_events (provider, provider_event_id, event_type, signature_verified)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [params.provider, evt.eventId, evt.eventType]
    );
    if (!inserted.rowCount) {
      return { duplicate: true };
    }

    const payRes = await client.query<{
      id: string;
      prescription_id: string;
      hospital_id: string;
      pharmacy_id: string;
      patient_user_id: string;
      prescription_number: string;
    }>(
      `SELECT pay.id, pay.prescription_id, pay.hospital_id, pay.pharmacy_id,
              p.user_id AS patient_user_id, rx.prescription_number
       FROM payments pay
       JOIN patients p ON p.id = pay.patient_id
       JOIN prescriptions rx ON rx.id = pay.prescription_id
       WHERE pay.provider = $1 AND pay.provider_session_id = $2
       LIMIT 1`,
      [params.provider, evt.providerSessionId]
    );

    const payment = payRes.rows[0];
    if (!payment) {
      return { duplicate: false, missing: true };
    }

    await client.query(
      `UPDATE payments
       SET status = $1,
           provider_transaction_ref = COALESCE($2, provider_transaction_ref),
           verified_via_webhook = TRUE,
           updated_at = NOW()
       WHERE id = $3`,
      [evt.status, evt.transactionRef ?? null, payment.id]
    );

    await client.query(
      `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
       VALUES ($1, $2, 'PAYMENT', 'Payment Status Verified', $3, '/patient')`,
      [
        payment.patient_user_id,
        payment.hospital_id,
        `Sandbox payment for prescription ${payment.prescription_number} is now ${evt.status}.`,
      ]
    );

    await recordAuditEvent(
      {
        hospitalId: payment.hospital_id,
        action: `PAYMENT_WEBHOOK_${evt.status}`,
        resourceType: "PAYMENT",
        resourceId: payment.id,
        outcome: "SUCCESS",
        metadata: {
          provider: params.provider,
          eventId: evt.eventId,
          verifiedViaWebhook: true,
        },
      },
      client
    );

    return { duplicate: false };
  });

  return { ok: true, duplicate: Boolean(outcome.duplicate) };
}
