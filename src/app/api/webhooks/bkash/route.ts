import { NextRequest, NextResponse } from "next/server";
import { processVerifiedPaymentWebhook } from "@/lib/payments/webhook-processor";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-bkash-signature") || req.headers.get("x-medora-signature");

  const result = await processVerifiedPaymentWebhook({
    provider: "BKASH_SANDBOX",
    rawBody,
    signatureHeader: signature,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ received: true, duplicate: result.duplicate });
}
