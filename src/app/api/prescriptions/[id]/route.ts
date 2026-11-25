import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth/guards";
import { getClientIp, withRlsContext } from "@/lib/db";
import {
  amendPrescriptionSchema,
  pharmacyFulfillmentSchema,
} from "@/lib/validators/schemas";
import { generateHumanId } from "@/lib/security/crypto";
import { sanitizeText } from "@/lib/security/sanitize";
import { recordAuditEvent } from "@/lib/security/audit";

const cancelSchema = z.object({
  action: z.literal("CANCEL"),
  reason: z.string().trim().min(4).max(300),
});

const routeSchema = z.object({
  action: z.literal("ROUTE"),
  pharmacyId: z.string().uuid(),
});

const PHARMACY_TRANSITIONS: Record<string, string[]> = {
  SENT_TO_PHARMACY: ["ACCEPTED", "CLARIFICATION_REQUESTED", "REJECTED_UNAVAILABLE"],
  CLARIFICATION_REQUESTED: ["ACCEPTED", "REJECTED_UNAVAILABLE"],
  ACCEPTED: ["PREPARING", "READY_FOR_PICKUP", "CLARIFICATION_REQUESTED", "REJECTED_UNAVAILABLE"],
  PREPARING: ["READY_FOR_PICKUP", "DISPENSED"],
  READY_FOR_PICKUP: ["DISPENSED"],
};

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, { skipCsrf: true });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid prescription ID." }, { status: 400 });
  }

  const rx = await withRlsContext(auth.ctx.rls, async (client) => {
    const res = await client.query(
      `SELECT rx.*,
              p.patient_uid,
              pu.id AS patient_user_id,
              pu.full_name AS patient_name,
              du.full_name AS doctor_name,
              h.name AS hospital_name,
              ph.name AS pharmacy_name,
              COALESCE(
                (SELECT json_agg(row_to_json(pi) ORDER BY pi.created_at ASC)
                 FROM prescription_items pi WHERE pi.prescription_id = rx.id),
                '[]'::json
              ) AS items
       FROM prescriptions rx
       JOIN patients p ON p.id = rx.patient_id
       JOIN users pu ON pu.id = p.user_id
       JOIN users du ON du.id = rx.doctor_user_id
       JOIN hospitals h ON h.id = rx.hospital_id
       LEFT JOIN pharmacies ph ON ph.id = rx.pharmacy_id
       WHERE rx.id = $1
       LIMIT 1`,
      [id]
    );

    const row = res.rows[0];
    if (!row) return null;

    // Explicit BOLA verification in addition to PostgreSQL RLS
    const allowed =
      auth.ctx.role === "PLATFORM_ADMIN" ||
      (auth.ctx.role === "PATIENT" && row.patient_user_id === auth.ctx.userId) ||
      (auth.ctx.role === "DOCTOR" &&
        row.doctor_user_id === auth.ctx.userId &&
        row.hospital_id === auth.ctx.activeHospitalId) ||
      (auth.ctx.role === "PHARMACIST" &&
        row.pharmacy_id === auth.ctx.activePharmacyId &&
        row.hospital_id === auth.ctx.activeHospitalId) ||
      (auth.ctx.role === "HOSPITAL_ADMIN" && row.hospital_id === auth.ctx.activeHospitalId);

    if (!allowed) return "FORBIDDEN" as const;

    await recordAuditEvent(
      {
        actorUserId: auth.ctx.userId,
        actorRole: auth.ctx.role,
        hospitalId: row.hospital_id,
        action: "PRESCRIPTION_VIEWED",
        resourceType: "PRESCRIPTION",
        resourceId: row.prescription_number,
        outcome: "SUCCESS",
        ipAddress: getClientIp(req.headers),
      },
      client
    );

    return row;
  });

  if (rx === "FORBIDDEN") {
    return NextResponse.json({ error: "Access denied to this prescription." }, { status: 403 });
  }
  if (!rx) {
    return NextResponse.json({ error: "Prescription not found." }, { status: 404 });
  }

  return NextResponse.json({ prescription: rx });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireApiAuth(req, {
    roles: ["DOCTOR", "PHARMACIST"],
    requireActiveHospital: true,
  });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid prescription ID." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  const ip = getClientIp(req.headers);

  // DOCTOR ACTIONS: Cancel, Route, or Non-Destructive Amend
  if (auth.ctx.role === "DOCTOR") {
    if (body?.action === "CANCEL") {
      const parsed = cancelSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Provide a cancellation reason (min 4 chars)." }, { status: 400 });
      }
      try {
        await withRlsContext(auth.ctx.rls, async (client) => {
          const rxRes = await client.query(
            `SELECT rx.id, rx.prescription_number, rx.status, rx.doctor_user_id, rx.hospital_id, rx.pharmacy_id, p.user_id AS patient_user_id
             FROM prescriptions rx
             JOIN patients p ON p.id = rx.patient_id
             WHERE rx.id = $1 AND rx.doctor_user_id = $2 AND rx.hospital_id = $3 LIMIT 1`,
            [id, auth.ctx.userId, auth.ctx.activeHospitalId]
          );
          const rx = rxRes.rows[0];
          if (!rx) throw new Error("NOT_FOUND");
          if (["DISPENSED", "CANCELLED", "AMENDED"].includes(rx.status)) {
            throw new Error("INVALID_STATE");
          }

          await client.query(
            `UPDATE prescriptions
             SET status = 'CANCELLED', amendment_reason = $1, cancelled_at = NOW(), updated_at = NOW()
             WHERE id = $2`,
            [sanitizeText(parsed.data.reason, 300), rx.id]
          );

          await client.query(
            `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
             VALUES ($1, $2, 'PRESCRIPTION', 'Prescription Cancelled', $3, '/patient')`,
            [
              rx.patient_user_id,
              rx.hospital_id,
              `Prescription ${rx.prescription_number} has been cancelled by your prescriber. Sign in for details.`,
            ]
          );

          await recordAuditEvent(
            {
              actorUserId: auth.ctx.userId,
              actorRole: auth.ctx.role,
              hospitalId: auth.ctx.activeHospitalId,
              action: "PRESCRIPTION_CANCELLED",
              resourceType: "PRESCRIPTION",
              resourceId: rx.prescription_number,
              outcome: "SUCCESS",
              ipAddress: ip,
            },
            client
          );
        });
        return NextResponse.json({ message: "Prescription cancelled and affected parties notified." });
      } catch (err) {
        if (err instanceof Error && err.message === "NOT_FOUND") {
          return NextResponse.json({ error: "Prescription not found in your active hospital." }, { status: 404 });
        }
        if (err instanceof Error && err.message === "INVALID_STATE") {
          return NextResponse.json({ error: "This prescription can no longer be cancelled." }, { status: 409 });
        }
        return NextResponse.json({ error: "Could not cancel prescription." }, { status: 500 });
      }
    }

    if (body?.action === "ROUTE") {
      const parsed = routeSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: "Select a valid pharmacy." }, { status: 400 });
      }
      try {
        await withRlsContext(auth.ctx.rls, async (client) => {
          const pharm = await client.query<{ id: string; name: string }>(
            "SELECT id, name FROM pharmacies WHERE id = $1 AND hospital_id = $2 AND status = 'ACTIVE' LIMIT 1",
            [parsed.data.pharmacyId, auth.ctx.activeHospitalId]
          );
          if (!pharm.rowCount) throw new Error("INVALID_PHARMACY");

          const rxRes = await client.query(
            `UPDATE prescriptions
             SET pharmacy_id = $1, status = 'SENT_TO_PHARMACY', routed_at = NOW(), updated_at = NOW()
             WHERE id = $2 AND doctor_user_id = $3 AND hospital_id = $4 AND status IN ('ISSUED','DRAFT')
             RETURNING prescription_number`,
            [pharm.rows[0].id, id, auth.ctx.userId, auth.ctx.activeHospitalId]
          );
          if (!rxRes.rowCount) throw new Error("NOT_FOUND");

          await recordAuditEvent(
            {
              actorUserId: auth.ctx.userId,
              actorRole: auth.ctx.role,
              hospitalId: auth.ctx.activeHospitalId,
              action: "PRESCRIPTION_ROUTED",
              resourceType: "PRESCRIPTION",
              resourceId: rxRes.rows[0].prescription_number,
              outcome: "SUCCESS",
              ipAddress: ip,
              metadata: { pharmacyId: pharm.rows[0].id },
            },
            client
          );
        });
        return NextResponse.json({ message: "Prescription routed to verified hospital pharmacy." });
      } catch (err) {
        if (err instanceof Error && err.message === "INVALID_PHARMACY") {
          return NextResponse.json({ error: "Pharmacy does not belong to your active hospital." }, { status: 403 });
        }
        return NextResponse.json({ error: "Could not route prescription." }, { status: 400 });
      }
    }

    // Non-destructive AMENDMENT: marks original AMENDED and creates linked replacement
    const parsedAmend = amendPrescriptionSchema.safeParse(body);
    if (!parsedAmend.success) {
      return NextResponse.json(
        { error: parsedAmend.error.issues[0]?.message || "Invalid amendment payload." },
        { status: 400 }
      );
    }

    try {
      const amended = await withRlsContext(auth.ctx.rls, async (client) => {
        const origRes = await client.query(
          `SELECT rx.*, p.user_id AS patient_user_id
           FROM prescriptions rx
           JOIN patients p ON p.id = rx.patient_id
           WHERE rx.id = $1 AND rx.doctor_user_id = $2 AND rx.hospital_id = $3 LIMIT 1`,
          [id, auth.ctx.userId, auth.ctx.activeHospitalId]
        );
        const orig = origRes.rows[0];
        if (!orig) throw new Error("NOT_FOUND");
        if (["DISPENSED", "CANCELLED", "AMENDED"].includes(orig.status)) {
          throw new Error("IMMUTABLE");
        }

        const nextPharmacyId = parsedAmend.data.pharmacyId ?? orig.pharmacy_id;
        if (nextPharmacyId) {
          const pharm = await client.query(
            "SELECT id FROM pharmacies WHERE id = $1 AND hospital_id = $2 AND status = 'ACTIVE' LIMIT 1",
            [nextPharmacyId, auth.ctx.activeHospitalId]
          );
          if (!pharm.rowCount) throw new Error("INVALID_PHARMACY");
        }

        await client.query(
          "UPDATE prescriptions SET status = 'AMENDED', amendment_reason = $1, updated_at = NOW() WHERE id = $2",
          [sanitizeText(parsedAmend.data.amendmentReason, 300), orig.id]
        );

        const nextRxNumber = generateHumanId("RX-2026");
        const nextStatus = nextPharmacyId ? "SENT_TO_PHARMACY" : "ISSUED";

        const newRx = await client.query<{ id: string }>(
          `INSERT INTO prescriptions (
             prescription_number, patient_id, doctor_user_id, hospital_id, pharmacy_id,
             parent_prescription_id, amendment_reason, verification_method, status,
             clinical_notes, issued_at, routed_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)
           RETURNING id`,
          [
            nextRxNumber,
            orig.patient_id,
            auth.ctx.userId,
            auth.ctx.activeHospitalId,
            nextPharmacyId,
            orig.id,
            sanitizeText(parsedAmend.data.amendmentReason, 300),
            orig.verification_method,
            nextStatus,
            parsedAmend.data.clinicalNotes
              ? sanitizeText(parsedAmend.data.clinicalNotes, 1000)
              : orig.clinical_notes,
            nextStatus === "SENT_TO_PHARMACY" ? new Date().toISOString() : null,
          ]
        );

        for (const item of parsedAmend.data.items) {
          await client.query(
            `INSERT INTO prescription_items (
               prescription_id, medicine_id, medicine_name, generic_name, strength,
               dosage_form, dose, route, frequency, duration, quantity, refills, instructions
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              newRx.rows[0].id,
              item.medicineId || null,
              sanitizeText(item.medicineName, 140),
              item.genericName ? sanitizeText(item.genericName, 140) : null,
              sanitizeText(item.strength, 60),
              sanitizeText(item.dosageForm, 60),
              sanitizeText(item.dose, 80),
              sanitizeText(item.route, 60),
              sanitizeText(item.frequency, 100),
              sanitizeText(item.duration, 60),
              item.quantity,
              item.refills,
              item.instructions ? sanitizeText(item.instructions, 300) : null,
            ]
          );
        }

        await client.query(
          `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
           VALUES ($1, $2, 'PRESCRIPTION', 'Prescription Amended', $3, '/patient')`,
          [
            orig.patient_user_id,
            orig.hospital_id,
            `Prescription ${orig.prescription_number} was replaced by amended prescription ${nextRxNumber}.`,
          ]
        );

        await recordAuditEvent(
          {
            actorUserId: auth.ctx.userId,
            actorRole: auth.ctx.role,
            hospitalId: auth.ctx.activeHospitalId,
            action: "PRESCRIPTION_AMENDED",
            resourceType: "PRESCRIPTION",
            resourceId: nextRxNumber,
            outcome: "SUCCESS",
            ipAddress: ip,
            metadata: { replacedPrescriptionNumber: orig.prescription_number },
          },
          client
        );

        return { id: newRx.rows[0].id, prescriptionNumber: nextRxNumber };
      });

      return NextResponse.json({
        message: `Created replacement prescription ${amended.prescriptionNumber}. Original preserved in audit history.`,
        prescription: amended,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "IMMUTABLE") {
        return NextResponse.json(
          { error: "Cannot amend a dispensed, cancelled, or already amended prescription." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Could not amend prescription." }, { status: 400 });
    }
  }

  // PHARMACIST ACTIONS: Availability, Confirmed Pricing & Fulfillment Lifecycle
  if (!auth.ctx.activePharmacyId) {
    return NextResponse.json(
      { error: "An approved pharmacy assignment is required." },
      { status: 403 }
    );
  }

  const parsedPharm = pharmacyFulfillmentSchema.safeParse(body);
  if (!parsedPharm.success) {
    return NextResponse.json(
      { error: parsedPharm.error.issues[0]?.message || "Invalid pharmacy update." },
      { status: 400 }
    );
  }

  try {
    const updated = await withRlsContext(auth.ctx.rls, async (client) => {
      const rxRes = await client.query(
        `SELECT rx.*, p.user_id AS patient_user_id
         FROM prescriptions rx
         JOIN patients p ON p.id = rx.patient_id
         WHERE rx.id = $1 AND rx.hospital_id = $2 AND rx.pharmacy_id = $3
         LIMIT 1`,
        [id, auth.ctx.activeHospitalId, auth.ctx.activePharmacyId]
      );
      const rx = rxRes.rows[0];
      if (!rx) throw new Error("NOT_FOUND");

      const allowedNext = PHARMACY_TRANSITIONS[rx.status] || [];
      if (parsedPharm.data.status !== rx.status && !allowedNext.includes(parsedPharm.data.status)) {
        throw new Error(`BAD_TRANSITION:${rx.status}->${parsedPharm.data.status}`);
      }

      // Update per-item availability & confirmed pricing
      if (parsedPharm.data.itemUpdates && parsedPharm.data.itemUpdates.length > 0) {
        for (const u of parsedPharm.data.itemUpdates) {
          const itemRes = await client.query<{ quantity: number }>(
            "SELECT quantity FROM prescription_items WHERE id = $1 AND prescription_id = $2 LIMIT 1",
            [u.itemId, rx.id]
          );
          if (!itemRes.rowCount) continue;
          const lineTotal = u.confirmedUnitPriceCents * itemRes.rows[0].quantity;
          await client.query(
            `UPDATE prescription_items
             SET availability_status = $1,
                 confirmed_unit_price_cents = $2,
                 line_total_cents = $3,
                 substitution_note = COALESCE($4, substitution_note)
             WHERE id = $5 AND prescription_id = $6`,
            [
              u.availabilityStatus,
              u.confirmedUnitPriceCents,
              lineTotal,
              u.substitutionNote ? sanitizeText(u.substitutionNote, 240) : null,
              u.itemId,
              rx.id,
            ]
          );
        }
      }

      // Recalculate confirmed total from DB items
      const sumRes = await client.query<{ total: number }>(
        `SELECT COALESCE(SUM(line_total_cents), 0)::int AS total
         FROM prescription_items
         WHERE prescription_id = $1 AND availability_status IN ('AVAILABLE','SUBSTITUTION_PROPOSED')`,
        [rx.id]
      );
      const totalCents = sumRes.rows[0]?.total ?? 0;
      const pricingConfirmed =
        ["ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "DISPENSED"].includes(parsedPharm.data.status) &&
        totalCents > 0;

      const tsField =
        parsedPharm.data.status === "ACCEPTED"
          ? ", accepted_at = COALESCE(accepted_at, NOW())"
          : parsedPharm.data.status === "READY_FOR_PICKUP"
          ? ", ready_at = COALESCE(ready_at, NOW())"
          : parsedPharm.data.status === "DISPENSED"
          ? ", dispensed_at = COALESCE(dispensed_at, NOW())"
          : "";

      await client.query(
        `UPDATE prescriptions
         SET status = $1,
             pharmacist_notes = COALESCE($2, pharmacist_notes),
             pickup_instructions = COALESCE($3, pickup_instructions),
             pricing_confirmed = $4,
             total_amount_cents = $5,
             updated_at = NOW()
             ${tsField}
         WHERE id = $6`,
        [
          parsedPharm.data.status,
          parsedPharm.data.pharmacistNotes
            ? sanitizeText(parsedPharm.data.pharmacistNotes, 600)
            : null,
          parsedPharm.data.pickupInstructions
            ? sanitizeText(parsedPharm.data.pickupInstructions, 400)
            : null,
          pricingConfirmed,
          totalCents,
          rx.id,
        ]
      );

      // Notify patient & doctor (no PHI in notification copy)
      const label = parsedPharm.data.status.replace(/_/g, " ").toLowerCase();
      await client.query(
        `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
         VALUES ($1, $2, 'PRESCRIPTION_STATUS', 'Prescription Status Updated', $3, '/patient')`,
        [
          rx.patient_user_id,
          rx.hospital_id,
          `Your prescription ${rx.prescription_number} is now ${label}. Sign in to view confirmation and next steps.`,
        ]
      );

      if (
        ["CLARIFICATION_REQUESTED", "REJECTED_UNAVAILABLE"].includes(parsedPharm.data.status)
      ) {
        await client.query(
          `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
           VALUES ($1, $2, 'CLINICAL_CLARIFICATION', 'Pharmacy Action Required', $3, '/doctor')`,
          [
            rx.doctor_user_id,
            rx.hospital_id,
            `Pharmacy updated prescription ${rx.prescription_number} to ${label}. Review pharmacist notes in your clinical inbox.`,
          ]
        );
      }

      await recordAuditEvent(
        {
          actorUserId: auth.ctx.userId,
          actorRole: auth.ctx.role,
          hospitalId: auth.ctx.activeHospitalId,
          action: `PHARMACY_STATUS_${parsedPharm.data.status}`,
          resourceType: "PRESCRIPTION",
          resourceId: rx.prescription_number,
          outcome: "SUCCESS",
          ipAddress: ip,
          metadata: { pricingConfirmed, totalAmountCents: totalCents },
        },
        client
      );

      return { status: parsedPharm.data.status, totalAmountCents: totalCents, pricingConfirmed };
    });

    return NextResponse.json({
      message: `Prescription updated to ${updated.status}.`,
      ...updated,
    });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return NextResponse.json(
          { error: "Prescription not found in your pharmacy inbox." },
          { status: 404 }
        );
      }
      if (err.message.startsWith("BAD_TRANSITION:")) {
        return NextResponse.json(
          { error: `Invalid prescription status transition (${err.message.slice(15)}).` },
          { status: 409 }
        );
      }
    }
    return NextResponse.json({ error: "Could not update prescription fulfillment." }, { status: 500 });
  }
}
