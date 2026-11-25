import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import { initiatePaymentSchema } from "@/lib/validators/schemas";
import { createSandboxCheckoutSession } from "@/lib/payments/providers";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { recordAuditEvent } from "@/lib/security/audit";

export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { skipCsrf: true });
  if (!auth.ok) return auth.response;

  const payments = await withRlsContext(auth.ctx.rls, async (client) => {
    const res = await client.query(
      `SELECT pay.*, rx.prescription_number, h.name AS hospital_name, ph.name AS pharmacy_name
       FROM payments pay
       JOIN prescriptions rx ON rx.id = pay.prescription_id
       JOIN hospitals h ON h.id = pay.hospital_id
       JOIN pharmacies ph ON ph.id = pay.pharmacy_id
       ORDER BY pay.created_at DESC
       LIMIT 60`
    );
    return res.rows;
  });

  return NextResponse.json({ payments });
}

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { roles: ["PATIENT"] });
  if (!auth.ok) return auth.response;

  const rl = await checkRateLimit(`pay:init:${auth.ctx.userId}`, 10, 300);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many payment initiation attempts." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = initiatePaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid payment initiation payload." },
      { status: 400 }
    );
  }

  const ip = getClientIp(req.headers);

  try {
    const result = await withRlsContext(auth.ctx.rls, async (client) => {
      // Idempotency check
      const existing = await client.query(
        "SELECT * FROM payments WHERE idempotency_key = $1 LIMIT 1",
        [parsed.data.idempotencyKey]
      );
      if (existing.rowCount && existing.rowCount > 0) {
        const pay = existing.rows[0];
        return {
          payment: pay,
          checkoutUrl: `/patient/checkout/${pay.id}?provider=${pay.provider.toLowerCase()}&session=${pay.provider_session_id}`,
          idempotentReplay: true,
        };
      }

      // Strict BOLA: verify prescription belongs to this patient AND pharmacy has confirmed pricing!
      const rxRes = await client.query<{
        id: string;
        prescription_number: string;
        patient_id: string;
        hospital_id: string;
        pharmacy_id: string | null;
        pricing_confirmed: boolean;
        total_amount_cents: number;
        currency: string;
        status: string;
      }>(
        `SELECT rx.id, rx.prescription_number, rx.patient_id, rx.hospital_id, rx.pharmacy_id,
                rx.pricing_confirmed, rx.total_amount_cents, rx.currency, rx.status
         FROM prescriptions rx
         JOIN patients p ON p.id = rx.patient_id
         WHERE rx.id = $1 AND p.user_id = $2
         LIMIT 1`,
        [parsed.data.prescriptionId, auth.ctx.userId]
      );

      const rx = rxRes.rows[0];
      if (!rx) throw new Error("NOT_FOUND");
      if (!rx.pharmacy_id || !rx.pricing_confirmed || rx.total_amount_cents <= 0) {
        throw new Error("UNCONFIRMED_PRICE");
      }
      if (["CANCELLED", "AMENDED", "REJECTED_UNAVAILABLE"].includes(rx.status)) {
        throw new Error("NOT_PAYABLE");
      }

      // Block duplicate succeeded payment for the same prescription
      const alreadyPaid = await client.query(
        "SELECT id FROM payments WHERE prescription_id = $1 AND status = 'SUCCEEDED' LIMIT 1",
        [rx.id]
      );
      if (alreadyPaid.rowCount && alreadyPaid.rowCount > 0) {
        throw new Error("ALREADY_PAID");
      }

      const insertRes = await client.query<{ id: string }>(
        `INSERT INTO payments (
           prescription_id, patient_id, hospital_id, pharmacy_id, provider,
           status, amount_cents, currency, idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,'INITIATED',$6,$7,$8)
         RETURNING id`,
        [
          rx.id,
          rx.patient_id,
          rx.hospital_id,
          rx.pharmacy_id,
          parsed.data.provider,
          rx.total_amount_cents,
          rx.currency,
          parsed.data.idempotencyKey,
        ]
      );
      const paymentId = insertRes.rows[0].id;

      const session = await createSandboxCheckoutSession({
        paymentId,
        prescriptionNumber: rx.prescription_number,
        amountCents: rx.total_amount_cents,
        currency: rx.currency,
        provider: parsed.data.provider,
      });

      // Use system bypass for provider_session_id update inside same verified tx
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      await client.query(
        "UPDATE payments SET provider_session_id = $1, status = 'PENDING', updated_at = NOW() WHERE id = $2",
        [session.providerSessionId, paymentId]
      );

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId: rx.hospital_id,
          action: "PAYMENT_SANDBOX_INITIATED",
          resourceType: "PAYMENT",
          resourceId: paymentId,
          outcome: "SUCCESS",
          ipAddress: ip,
          metadata: {
            provider: parsed.data.provider,
            amountCents: rx.total_amount_cents,
            prescriptionNumber: rx.prescription_number,
          },
        },
        client
      );

      return {
        payment: {
          id: paymentId,
          provider: parsed.data.provider,
          status: "PENDING",
          amount_cents: rx.total_amount_cents,
          currency: rx.currency,
          provider_session_id: session.providerSessionId,
        },
        checkoutUrl: session.checkoutUrl,
        idempotentReplay: false,
      };
    });

    return NextResponse.json(result, { status: result.idempotentReplay ? 200 : 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Prescription not found." }, { status: 404 });
      }
      if (err.message === "UNCONFIRMED_PRICE") {
        return NextResponse.json(
          { error: "Payment is blocked until the pharmacy confirms medicine availability and final price." },
          { status: 409 }
        );
      }
      if (err.message === "NOT_PAYABLE") {
        return NextResponse.json({ error: "This prescription is not eligible for payment." }, { status: 409 });
      }
      if (err.message === "ALREADY_PAID") {
        return NextResponse.json({ error: "This prescription has already been paid." }, { status: 409 });
      }
    }
    return NextResponse.json({ error: "Could not initiate sandbox checkout." }, { status: 500 });
  }
}
