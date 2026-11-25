import { z } from "zod";

export const patientRegisterSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required").max(120),
  email: z.string().trim().email("Valid email is required").max(160),
  username: z
    .string()
    .trim()
    .min(3, "Username must be 3-40 characters")
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, ., _, and -"),
  phone: z.string().trim().min(7, "Valid phone number is required").max(20),
  dateOfBirth: z.string().trim().optional(),
  address: z.string().trim().max(250).optional(),
  password: z.string().min(12, "Password must be at least 12 characters").max(128),
});

export const staffRegisterSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/),
  phone: z.string().trim().min(7).max(20),
  role: z.enum(["DOCTOR", "PHARMACIST"]),
  hospitalId: z.string().uuid("Select a valid hospital"),
  pharmacyId: z.string().uuid().optional().or(z.literal("")),
  licenseNumber: z.string().trim().min(3, "Professional license number is required").max(80),
  issuingJurisdiction: z.string().trim().min(2).max(80),
  specialty: z.string().trim().max(120).optional(),
  credentials: z.string().trim().max(120).optional(),
  workplaceAffiliation: z.string().trim().max(160).optional(),
  password: z.string().min(12).max(128),
});

export const activateAccountSchema = z.object({
  activationCode: z.string().trim().min(8).max(64),
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  dateOfBirth: z.string().trim().optional(),
  address: z.string().trim().max(250).optional(),
  password: z.string().min(12).max(128),
});

export const provisionPatientSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(20),
  dateOfBirth: z.string().trim().optional(),
  address: z.string().trim().max(250).optional(),
});

export const patientLookupSchema = z.object({
  identifier: z.string().trim().min(3).max(80),
});

export const verifyPatientSchema = z.object({
  patientId: z.string().uuid(),
  method: z.enum(["GENERATOR_CODE", "OTP"]),
  code: z.string().trim().min(4).max(32),
});

export const prescriptionItemSchema = z.object({
  medicineId: z.string().uuid().optional().nullable(),
  medicineName: z.string().trim().min(2).max(140),
  genericName: z.string().trim().max(140).optional().nullable(),
  strength: z.string().trim().min(1).max(60),
  dosageForm: z.string().trim().min(2).max(60),
  dose: z.string().trim().min(1).max(80),
  route: z.string().trim().min(2).max(60),
  frequency: z.string().trim().min(2).max(100),
  duration: z.string().trim().min(1).max(60),
  quantity: z.coerce.number().int().min(1).max(500),
  refills: z.coerce.number().int().min(0).max(12).default(0),
  instructions: z.string().trim().max(300).optional().nullable(),
});

export const createPrescriptionSchema = z.object({
  patientId: z.string().uuid(),
  pharmacyId: z.string().uuid().optional().nullable(),
  verificationMethod: z.enum([
    "GENERATOR_CODE",
    "OTP",
    "NEW_PATIENT_PROVISION",
    "IN_PERSON_ESCALATION",
  ]),
  verificationProof: z.string().trim().max(128).optional(),
  clinicalNotes: z.string().trim().max(1000).optional(),
  routeImmediately: z.boolean().default(true),
  items: z.array(prescriptionItemSchema).min(1, "At least one medicine is required").max(20),
});

export const amendPrescriptionSchema = z.object({
  amendmentReason: z.string().trim().min(4, "Provide an amendment reason").max(300),
  pharmacyId: z.string().uuid().optional().nullable(),
  clinicalNotes: z.string().trim().max(1000).optional(),
  items: z.array(prescriptionItemSchema).min(1).max(20),
});

export const pharmacyFulfillmentSchema = z.object({
  status: z.enum([
    "ACCEPTED",
    "CLARIFICATION_REQUESTED",
    "PREPARING",
    "READY_FOR_PICKUP",
    "DISPENSED",
    "REJECTED_UNAVAILABLE",
  ]),
  pharmacistNotes: z.string().trim().max(600).optional(),
  pickupInstructions: z.string().trim().max(400).optional(),
  itemUpdates: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        availabilityStatus: z.enum([
          "PENDING",
          "AVAILABLE",
          "UNAVAILABLE",
          "SUBSTITUTION_PROPOSED",
        ]),
        confirmedUnitPriceCents: z.coerce.number().int().min(0).max(10_000_000),
        substitutionNote: z.string().trim().max(240).optional(),
      })
    )
    .optional(),
});

export const createMedicineSchema = z.object({
  genericId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(140),
  strength: z.string().trim().min(1).max(60),
  dosageForm: z.string().trim().min(2).max(60),
  manufacturer: z.string().trim().max(120).optional(),
  packSize: z.string().trim().max(80).optional(),
  sku: z.string().trim().max(60).optional(),
  unitPriceCents: z.coerce.number().int().min(0).max(10_000_000),
  availabilityStatus: z.enum(["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"]).default("IN_STOCK"),
  imageUploadId: z.string().uuid().optional().nullable(),
});

export const createGenericSchema = z.object({
  name: z.string().trim().min(2).max(140),
  drugClass: z.string().trim().max(120).optional(),
  description: z.string().trim().max(600).optional(),
  commonStrengths: z.string().trim().max(200).optional(),
});

export const createHospitalSchema = z.object({
  name: z.string().trim().min(2).max(140),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
  registrationCode: z.string().trim().min(3).max(50),
  address: z.string().trim().max(240).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
});

export const createPharmacySchema = z.object({
  name: z.string().trim().min(2).max(140),
  code: z.string().trim().min(2).max(40),
  address: z.string().trim().max(240).optional(),
  phone: z.string().trim().max(30).optional(),
  pickupInstructions: z.string().trim().max(400).optional(),
});

export const initiatePaymentSchema = z.object({
  prescriptionId: z.string().uuid(),
  provider: z.enum(["STRIPE_SANDBOX", "BKASH_SANDBOX"]),
  idempotencyKey: z.string().trim().min(8).max(100),
});
