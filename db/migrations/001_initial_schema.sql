-- Medora Multi-Hospital Online Prescription Platform
-- Migration 001: Core Relational Schema

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Users (Identity, Auth, MFA, Context)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  username TEXT UNIQUE NOT NULL,
  username_changed_at TIMESTAMPTZ,
  phone TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  full_name TEXT NOT NULL,
  password_hash TEXT,
  primary_role TEXT NOT NULL CHECK (primary_role IN ('PLATFORM_ADMIN','HOSPITAL_ADMIN','DOCTOR','PHARMACIST','PATIENT')),
  account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','PENDING_ACTIVATION','PENDING_APPROVAL','SUSPENDED')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_encrypted TEXT,
  mfa_recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_hospital_id UUID,
  active_pharmacy_id UUID,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_primary_role ON users (primary_role);

-- 2. Hospitals (Tenants)
CREATE TABLE IF NOT EXISTS hospitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  registration_code TEXT UNIQUE NOT NULL,
  address TEXT,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Pharmacies (Hospital-associated locations)
CREATE TABLE IF NOT EXISTS pharmacies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  pickup_instructions TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hospital_id, code)
);

CREATE INDEX IF NOT EXISTS idx_pharmacies_hospital ON pharmacies (hospital_id);

-- Add FK constraints for active context columns now that hospitals/pharmacies exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_active_hospital'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_active_hospital FOREIGN KEY (active_hospital_id) REFERENCES hospitals(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_active_pharmacy'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_active_pharmacy FOREIGN KEY (active_pharmacy_id) REFERENCES pharmacies(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Hospital Staff Memberships (Multi-Hospital Role & License Verification)
CREATE TABLE IF NOT EXISTS hospital_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('HOSPITAL_ADMIN','DOCTOR','PHARMACIST')),
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
  license_number TEXT,
  issuing_jurisdiction TEXT,
  specialty TEXT,
  credentials TEXT,
  workplace_affiliation TEXT,
  license_expires_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, hospital_id, role)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON hospital_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_hospital ON hospital_memberships (hospital_id);
CREATE INDEX IF NOT EXISTS idx_memberships_pharmacy ON hospital_memberships (pharmacy_id) WHERE pharmacy_id IS NOT NULL;

-- 5. Patients (Immutable internal patient ID + hashed generator code)
CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_uid TEXT UNIQUE NOT NULL,
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth DATE,
  address TEXT,
  emergency_contact TEXT,
  allergies TEXT,
  generator_code_hash TEXT,
  generator_code_updated_at TIMESTAMPTZ,
  provisioned_by_doctor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provisioned_hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_patients_uid ON patients (patient_uid);

-- 6. One-Time Patient Activation Tokens (No plaintext passwords)
CREATE TABLE IF NOT EXISTS patient_activation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lookup_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activation_prefix ON patient_activation_tokens (lookup_prefix) WHERE used_at IS NULL;

-- 7. Doctor-Assisted Patient Verification OTPs
CREATE TABLE IF NOT EXISTS patient_verification_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  otp_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  verification_session_token_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_lookup ON patient_verification_otps (patient_id, doctor_user_id, hospital_id);

-- 8. Generics (Active Ingredient Catalog)
CREATE TABLE IF NOT EXISTS generics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT UNIQUE NOT NULL,
  drug_class TEXT,
  description TEXT,
  common_strengths TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','UNDER_REVIEW','INACTIVE')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Uploaded Files (Validated private file storage metadata)
CREATE TABLE IF NOT EXISTS uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('CATALOG_IMAGE','LICENSE_DOCUMENT','PRESCRIPTION_ATTACHMENT')),
  original_filename TEXT NOT NULL,
  stored_filename TEXT UNIQUE NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  sha256_hex TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Medicines (Hospital/Pharmacy-Scoped Product Catalog)
CREATE TABLE IF NOT EXISTS medicines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  generic_id UUID NOT NULL REFERENCES generics(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  strength TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  manufacturer TEXT,
  pack_size TEXT,
  sku TEXT,
  unit_price_cents INT NOT NULL CHECK (unit_price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  availability_status TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK (availability_status IN ('IN_STOCK','LOW_STOCK','OUT_OF_STOCK')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  image_upload_id UUID REFERENCES uploaded_files(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (pharmacy_id, display_name, strength, dosage_form)
);

CREATE INDEX IF NOT EXISTS idx_medicines_hospital ON medicines (hospital_id);
CREATE INDEX IF NOT EXISTS idx_medicines_pharmacy ON medicines (pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_medicines_generic ON medicines (generic_id);

-- 11. Prescriptions (Clinical Lifecycle & Non-Destructive Amendments)
CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_number TEXT UNIQUE NOT NULL,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  doctor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE RESTRICT,
  pharmacy_id UUID REFERENCES pharmacies(id) ON DELETE RESTRICT,
  parent_prescription_id UUID REFERENCES prescriptions(id) ON DELETE SET NULL,
  amendment_reason TEXT,
  verification_method TEXT NOT NULL CHECK (verification_method IN ('GENERATOR_CODE','OTP','NEW_PATIENT_PROVISION','IN_PERSON_ESCALATION')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','ISSUED','SENT_TO_PHARMACY','ACCEPTED','CLARIFICATION_REQUESTED',
    'PREPARING','READY_FOR_PICKUP','DISPENSED','REJECTED_UNAVAILABLE','CANCELLED','AMENDED'
  )),
  clinical_notes TEXT,
  pharmacist_notes TEXT,
  pickup_instructions TEXT,
  pricing_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  total_amount_cents INT NOT NULL DEFAULT 0 CHECK (total_amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  issued_at TIMESTAMPTZ,
  routed_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  dispensed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON prescriptions (patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor ON prescriptions (doctor_user_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_hospital ON prescriptions (hospital_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_pharmacy ON prescriptions (pharmacy_id) WHERE pharmacy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON prescriptions (status);

-- 12. Prescription Line Items
CREATE TABLE IF NOT EXISTS prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  medicine_id UUID REFERENCES medicines(id) ON DELETE SET NULL,
  medicine_name TEXT NOT NULL,
  generic_name TEXT,
  strength TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  dose TEXT NOT NULL,
  route TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration TEXT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  refills INT NOT NULL DEFAULT 0 CHECK (refills >= 0 AND refills <= 12),
  instructions TEXT,
  availability_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (availability_status IN ('PENDING','AVAILABLE','UNAVAILABLE','SUBSTITUTION_PROPOSED')),
  confirmed_unit_price_cents INT NOT NULL DEFAULT 0 CHECK (confirmed_unit_price_cents >= 0),
  line_total_cents INT NOT NULL DEFAULT 0 CHECK (line_total_cents >= 0),
  substitution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rx_items_prescription ON prescription_items (prescription_id);

-- 13. Payments (Sandbox Stripe & bKash with Reconciliation & Idempotency)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE RESTRICT,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  hospital_id UUID NOT NULL REFERENCES hospitals(id) ON DELETE RESTRICT,
  pharmacy_id UUID NOT NULL REFERENCES pharmacies(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider IN ('STRIPE_SANDBOX','BKASH_SANDBOX')),
  status TEXT NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED','PENDING','SUCCEEDED','FAILED','CANCELLED','REFUNDED')),
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'BDT',
  idempotency_key TEXT UNIQUE NOT NULL,
  provider_session_id TEXT UNIQUE,
  provider_transaction_ref TEXT,
  verified_via_webhook BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_prescription ON payments (prescription_id);
CREATE INDEX IF NOT EXISTS idx_payments_patient ON payments (patient_id);
CREATE INDEX IF NOT EXISTS idx_payments_hospital ON payments (hospital_id);

-- 14. Webhook Idempotency Log
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('STRIPE_SANDBOX','BKASH_SANDBOX')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT TRUE,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_event_id)
);

-- 15. Authenticated In-App Notifications (No PHI in external SMS/email)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at DESC);

-- 16. Tamper-Evident Hash-Chained Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT,
  hospital_id UUID REFERENCES hospitals(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILURE')),
  ip_address TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_hospital_time ON audit_logs (hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action, created_at DESC);

-- 17. Rate Limits (PostgreSQL-backed sliding window)
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INT NOT NULL DEFAULT 1,
  window_reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits (window_reset_at);
