-- Medora Multi-Hospital Online Prescription Platform
-- Migration 002: PostgreSQL Row Level Security (RLS) Policies

CREATE OR REPLACE FUNCTION app_user_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION app_user_role() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.user_role', true), '');
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION app_hospital_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.hospital_id', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION app_pharmacy_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.pharmacy_id', true), '')::UUID;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION app_is_system() RETURNS BOOLEAN AS $$
  SELECT current_setting('app.bypass_rls', true) = 'true';
$$ LANGUAGE SQL STABLE;

-- Enable & force RLS on all tenant-scoped and clinical tables
ALTER TABLE hospitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospitals FORCE ROW LEVEL SECURITY;

ALTER TABLE pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacies FORCE ROW LEVEL SECURITY;

ALTER TABLE hospital_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE hospital_memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescription_items FORCE ROW LEVEL SECURITY;

ALTER TABLE medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicines FORCE ROW LEVEL SECURITY;

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files FORCE ROW LEVEL SECURITY;

-- Drop existing policies cleanly for idempotent reruns
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'hospitals','pharmacies','hospital_memberships','patients',
        'prescriptions','prescription_items','medicines','payments',
        'notifications','audit_logs','uploaded_files'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- HOSPITALS: Active hospitals readable for browsing/registration; write only by platform admin or scoped hospital admin
CREATE POLICY hospitals_select ON hospitals
  FOR SELECT USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR status = 'ACTIVE'
    OR id = app_hospital_id()
  );

CREATE POLICY hospitals_modify ON hospitals
  FOR ALL USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND id = app_hospital_id())
  )
  WITH CHECK (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND id = app_hospital_id())
  );

-- PHARMACIES: Active pharmacies visible for catalog & hospital routing; mutations scoped to hospital admin / platform admin
CREATE POLICY pharmacies_select ON pharmacies
  FOR SELECT USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR status = 'ACTIVE'
    OR hospital_id = app_hospital_id()
  );

CREATE POLICY pharmacies_modify ON pharmacies
  FOR ALL USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND hospital_id = app_hospital_id())
  )
  WITH CHECK (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND hospital_id = app_hospital_id())
  );

-- HOSPITAL_MEMBERSHIPS: Users see own memberships; Hospital Admin sees/manages only their active hospital; Platform Admin sees all
CREATE POLICY memberships_select ON hospital_memberships
  FOR SELECT USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR user_id = app_user_id()
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND hospital_id = app_hospital_id())
    OR (app_user_role() = 'DOCTOR' AND hospital_id = app_hospital_id() AND verification_status = 'APPROVED')
  );

CREATE POLICY memberships_modify ON hospital_memberships
  FOR ALL USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND hospital_id = app_hospital_id())
  )
  WITH CHECK (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND hospital_id = app_hospital_id())
  );

-- PATIENTS: Own patient profile, verified prescriber in active hospital, or pharmacist fulfilling a routed prescription
CREATE POLICY patients_select ON patients
  FOR SELECT USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR user_id = app_user_id()
    OR (app_user_role() = 'DOCTOR' AND app_hospital_id() IS NOT NULL)
    OR (
      app_user_role() = 'PHARMACIST'
      AND app_pharmacy_id() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM prescriptions rx
        WHERE rx.patient_id = patients.id
          AND rx.pharmacy_id = app_pharmacy_id()
          AND rx.hospital_id = app_hospital_id()
      )
    )
  );

CREATE POLICY patients_modify ON patients
  FOR ALL USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR user_id = app_user_id()
    OR (app_user_role() = 'DOCTOR' AND app_hospital_id() IS NOT NULL)
  )
  WITH CHECK (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR user_id = app_user_id()
    OR (app_user_role() = 'DOCTOR' AND app_hospital_id() IS NOT NULL)
  );

-- PRESCRIPTIONS: Strict BOLA + Tenant Isolation
CREATE POLICY prescriptions_select ON prescriptions
  FOR SELECT USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (
      app_user_role() = 'PATIENT'
      AND EXISTS (SELECT 1 FROM patients p WHERE p.id = prescriptions.patient_id AND p.user_id = app_user_id())
    )
    OR (
      app_user_role() = 'DOCTOR'
      AND doctor_user_id = app_user_id()
      AND hospital_id = app_hospital_id()
    )
    OR (
      app_user_role() = 'PHARMACIST'
      AND pharmacy_id = app_pharmacy_id()
      AND hospital_id = app_hospital_id()
    )
    OR (
      app_user_role() = 'HOSPITAL_ADMIN'
      AND hospital_id = app_hospital_id()
    )
  );

CREATE POLICY prescriptions_insert ON prescriptions
  FOR INSERT WITH CHECK (
    app_is_system()
    OR (
      app_user_role() = 'DOCTOR'
      AND doctor_user_id = app_user_id()
      AND hospital_id = app_hospital_id()
    )
  );

CREATE POLICY prescriptions_update ON prescriptions
  FOR UPDATE USING (
    app_is_system()
    OR (
      app_user_role() = 'DOCTOR'
      AND doctor_user_id = app_user_id()
      AND hospital_id = app_hospital_id()
    )
    OR (
      app_user_role() = 'PHARMACIST'
      AND pharmacy_id = app_pharmacy_id()
      AND hospital_id = app_hospital_id()
    )
  )
  WITH CHECK (
    app_is_system()
    OR (
      app_user_role() = 'DOCTOR'
      AND doctor_user_id = app_user_id()
      AND hospital_id = app_hospital_id()
    )
    OR (
      app_user_role() = 'PHARMACIST'
      AND pharmacy_id = app_pharmacy_id()
      AND hospital_id = app_hospital_id()
    )
  );

-- PRESCRIPTION_ITEMS: Inherits access from parent prescription
CREATE POLICY rx_items_all ON prescription_items
  FOR ALL USING (
    app_is_system()
    OR EXISTS (SELECT 1 FROM prescriptions rx WHERE rx.id = prescription_items.prescription_id)
  )
  WITH CHECK (
    app_is_system()
    OR EXISTS (SELECT 1 FROM prescriptions rx WHERE rx.id = prescription_items.prescription_id)
  );

-- MEDICINES: Active catalog readable for patient browse; mutations restricted to pharmacist/admin of that hospital & pharmacy
CREATE POLICY medicines_select ON medicines
  FOR SELECT USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR is_active = TRUE
    OR hospital_id = app_hospital_id()
  );

CREATE POLICY medicines_modify ON medicines
  FOR ALL USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND hospital_id = app_hospital_id())
    OR (app_user_role() = 'PHARMACIST' AND hospital_id = app_hospital_id() AND pharmacy_id = app_pharmacy_id())
  )
  WITH CHECK (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND hospital_id = app_hospital_id())
    OR (app_user_role() = 'PHARMACIST' AND hospital_id = app_hospital_id() AND pharmacy_id = app_pharmacy_id())
  );

-- PAYMENTS: Patient owns their payments; Pharmacist/Hospital Admin see their pharmacy/hospital payments; Platform Admin sees all
CREATE POLICY payments_select ON payments
  FOR SELECT USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR EXISTS (SELECT 1 FROM patients p WHERE p.id = payments.patient_id AND p.user_id = app_user_id())
    OR (app_user_role() = 'PHARMACIST' AND pharmacy_id = app_pharmacy_id() AND hospital_id = app_hospital_id())
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND hospital_id = app_hospital_id())
  );

CREATE POLICY payments_insert ON payments
  FOR INSERT WITH CHECK (
    app_is_system()
    OR EXISTS (SELECT 1 FROM patients p WHERE p.id = payments.patient_id AND p.user_id = app_user_id())
  );

CREATE POLICY payments_update ON payments
  FOR UPDATE USING (app_is_system() OR app_user_role() = 'PLATFORM_ADMIN')
  WITH CHECK (app_is_system() OR app_user_role() = 'PLATFORM_ADMIN');

-- NOTIFICATIONS: Strictly owner-scoped
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (app_is_system() OR user_id = app_user_id());

CREATE POLICY notifications_insert ON notifications
  FOR INSERT WITH CHECK (app_is_system() OR app_user_id() IS NOT NULL);

CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (app_is_system() OR user_id = app_user_id())
  WITH CHECK (app_is_system() OR user_id = app_user_id());

-- AUDIT_LOGS: Append-only; readable only by Platform Admin (all) or Hospital Admin (their hospital only)
CREATE POLICY audit_insert ON audit_logs
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY audit_select ON audit_logs
  FOR SELECT USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR (app_user_role() = 'HOSPITAL_ADMIN' AND hospital_id = app_hospital_id())
  );

-- UPLOADED_FILES: Uploader, scoped hospital admin/pharmacist, or platform admin
CREATE POLICY uploads_select ON uploaded_files
  FOR SELECT USING (
    app_is_system()
    OR app_user_role() = 'PLATFORM_ADMIN'
    OR uploaded_by = app_user_id()
    OR (purpose = 'CATALOG_IMAGE')
    OR (hospital_id IS NOT NULL AND hospital_id = app_hospital_id())
  );

CREATE POLICY uploads_insert ON uploaded_files
  FOR INSERT WITH CHECK (
    app_is_system()
    OR uploaded_by = app_user_id()
  );
