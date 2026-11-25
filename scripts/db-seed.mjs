import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

const dbUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("Missing DATABASE_ADMIN_URL or DATABASE_URL");
  process.exit(1);
}

function hashSecret(plaintext) {
  const salt = crypto.randomBytes(16).toString("hex");
  const N = 16384;
  const r = 8;
  const p = 1;
  const derived = crypto
    .scryptSync(plaintext, salt, 64, { N, r, p })
    .toString("hex");
  return `$scrypt$${N}$${r}$${p}$${salt}$${derived}`;
}

function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

// Generate strong non-trivial pilot passwords if not set in env (never weak defaults)
const seedPassword =
  process.env.SEED_DEFAULT_PASSWORD && process.env.SEED_DEFAULT_PASSWORD.length >= 12
    ? process.env.SEED_DEFAULT_PASSWORD
    : `Medora!${crypto.randomBytes(6).toString("base64url")}9`;

const patientGeneratorCode = "MED-7492-XK8P";

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL app.bypass_rls = 'true'");

  const pwHash = hashSecret(seedPassword);

  // 1. Seed Users (Platform Admin, 2 Hospital Admins, Multi-hospital Doctor, 2 Pharmacists, 2 Patients)
  const usersToSeed = [
    {
      email: "platform.admin@medora.health",
      username: "platform_admin",
      phone: "+8801700000001",
      fullName: "Amina Rahman (Platform Admin)",
      role: "PLATFORM_ADMIN",
      mustChange: true,
    },
    {
      email: "admin.northstar@medora.health",
      username: "northstar_admin",
      phone: "+8801700000002",
      fullName: "Tariq Hasan (Northstar Admin)",
      role: "HOSPITAL_ADMIN",
      mustChange: true,
    },
    {
      email: "admin.crestview@medora.health",
      username: "crestview_admin",
      phone: "+8801700000003",
      fullName: "Nadia Karim (Crestview Admin)",
      role: "HOSPITAL_ADMIN",
      mustChange: true,
    },
    {
      email: "dr.selina@medora.health",
      username: "dr_selina",
      phone: "+8801700000010",
      fullName: "Dr. Selina Chowdhury, MBBS, FCPS",
      role: "DOCTOR",
      mustChange: false,
    },
    {
      email: "pharm.harbor@medora.health",
      username: "pharm_harbor",
      phone: "+8801700000020",
      fullName: "Rafiqul Islam, B.Pharm",
      role: "PHARMACIST",
      mustChange: false,
    },
    {
      email: "pharm.crest@medora.health",
      username: "pharm_crest",
      phone: "+8801700000021",
      fullName: "Farhana Ahmed, M.Pharm",
      role: "PHARMACIST",
      mustChange: false,
    },
    {
      email: "patient.demo@medora.health",
      username: "patient_ayesha",
      phone: "+8801711223344",
      fullName: "Ayesha Siddiqua",
      role: "PATIENT",
      mustChange: false,
    },
  ];

  const userIds = {};
  for (const u of usersToSeed) {
    const res = await client.query(
      `INSERT INTO users (email, username, phone, phone_verified, full_name, password_hash, primary_role, account_status, must_change_password)
       VALUES ($1, $2, $3, TRUE, $4, $5, $6, 'ACTIVE', $7)
       ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [u.email, u.username, u.phone, u.fullName, pwHash, u.role, u.mustChange]
    );
    userIds[u.username] = res.rows[0].id;
  }

  // 2. Seed Hospitals (Matching Medora.fig: Northstar General + second tenant Crestview Medical)
  const h1 = await client.query(
    `INSERT INTO hospitals (name, slug, registration_code, address, phone, email, status, created_by)
     VALUES ('Northstar General', 'northstar-general', 'HSP-NSG-001', '42 Gulshan Avenue, Dhaka 1212', '+88029876543', 'care@northstar.health', 'ACTIVE', $1)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [userIds.platform_admin]
  );
  const northstarId = h1.rows[0].id;

  const h2 = await client.query(
    `INSERT INTO hospitals (name, slug, registration_code, address, phone, email, status, created_by)
     VALUES ('Crestview Medical Center', 'crestview-medical', 'HSP-CMC-002', '18 Dhanmondi Road 7, Dhaka 1205', '+88029123456', 'care@crestview.health', 'ACTIVE', $1)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [userIds.platform_admin]
  );
  const crestviewId = h2.rows[0].id;

  // 3. Seed Pharmacies (Matching Medora.fig: Harbor Pharmacy + Crestview Apothecary)
  const p1 = await client.query(
    `INSERT INTO pharmacies (hospital_id, name, code, address, phone, pickup_instructions, status)
     VALUES ($1, 'Harbor Pharmacy', 'PHM-HBR-01', 'Ground Floor, Northstar General East Wing', '+88029876550', 'Bring your Prescription Number and valid ID to Counter 2 (8:00 AM - 10:00 PM).', 'ACTIVE')
     ON CONFLICT (hospital_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [northstarId]
  );
  const harborPharmacyId = p1.rows[0].id;

  const p2 = await client.query(
    `INSERT INTO pharmacies (hospital_id, name, code, address, phone, pickup_instructions, status)
     VALUES ($1, 'Crestview Apothecary', 'PHM-CAP-01', 'Lobby Level, Crestview Medical Center', '+88029123490', 'Collect at Pharmacy Window A once status is Ready for Pickup.', 'ACTIVE')
     ON CONFLICT (hospital_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [crestviewId]
  );
  const crestPharmacyId = p2.rows[0].id;

  // 4. Seed Multi-Hospital Staff Memberships (Dr. Selina belongs to BOTH Northstar & Crestview!)
  const memberships = [
    [userIds.northstar_admin, northstarId, null, "HOSPITAL_ADMIN", "APPROVED", "ADM-NSG-01", "Bangladesh", "Hospital Administration", "MHA", "Northstar General"],
    [userIds.crestview_admin, crestviewId, null, "HOSPITAL_ADMIN", "APPROVED", "ADM-CMC-01", "Bangladesh", "Hospital Administration", "MBA-HM", "Crestview Medical Center"],
    [userIds.dr_selina, northstarId, null, "DOCTOR", "APPROVED", "BMDC-A-48219", "Bangladesh", "Internal Medicine", "MBBS, FCPS", "Northstar General"],
    [userIds.dr_selina, crestviewId, null, "DOCTOR", "APPROVED", "BMDC-A-48219", "Bangladesh", "Internal Medicine", "MBBS, FCPS", "Crestview Medical Center"],
    [userIds.pharm_harbor, northstarId, harborPharmacyId, "PHARMACIST", "APPROVED", "PCB-A-10442", "Bangladesh", "Clinical Pharmacy", "B.Pharm", "Harbor Pharmacy"],
    [userIds.pharm_crest, crestviewId, crestPharmacyId, "PHARMACIST", "APPROVED", "PCB-A-10918", "Bangladesh", "Hospital Pharmacy", "M.Pharm", "Crestview Apothecary"],
  ];

  for (const m of memberships) {
    await client.query(
      `INSERT INTO hospital_memberships (
         user_id, hospital_id, pharmacy_id, role, verification_status,
         license_number, issuing_jurisdiction, specialty, credentials, workplace_affiliation,
         approved_by, approved_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (user_id, hospital_id, role) DO UPDATE SET verification_status = 'APPROVED', pharmacy_id = EXCLUDED.pharmacy_id`,
      [...m, userIds.platform_admin]
    );
  }

  // Set default active hospital/pharmacy contexts on staff users
  await client.query("UPDATE users SET active_hospital_id = $1 WHERE id = $2", [northstarId, userIds.northstar_admin]);
  await client.query("UPDATE users SET active_hospital_id = $1 WHERE id = $2", [crestviewId, userIds.crestview_admin]);
  await client.query("UPDATE users SET active_hospital_id = $1 WHERE id = $2", [northstarId, userIds.dr_selina]);
  await client.query("UPDATE users SET active_hospital_id = $1, active_pharmacy_id = $2 WHERE id = $3", [northstarId, harborPharmacyId, userIds.pharm_harbor]);
  await client.query("UPDATE users SET active_hospital_id = $1, active_pharmacy_id = $2 WHERE id = $3", [crestviewId, crestPharmacyId, userIds.pharm_crest]);

  // 5. Seed Patient Profile with hashed Generator Code
  const patRes = await client.query(
    `INSERT INTO patients (patient_uid, user_id, date_of_birth, address, allergies, generator_code_hash, generator_code_updated_at)
     VALUES ('MED-PAT-100101', $1, '1994-06-15', 'House 14, Road 9, Banani, Dhaka', 'Penicillin (mild rash)', $2, NOW())
     ON CONFLICT (user_id) DO UPDATE SET generator_code_hash = EXCLUDED.generator_code_hash
     RETURNING id`,
    [userIds.patient_ayesha, hashSecret(patientGeneratorCode)]
  );
  const patientId = patRes.rows[0].id;

  // 6. Seed Generics
  const genericData = [
    ["Paracetamol (Acetaminophen)", "Analgesic & Antipyretic", "First-line pain reliever and fever reducer.", "500mg, 650mg"],
    ["Esomeprazole", "Proton Pump Inhibitor (PPI)", "Reduces stomach acid for GERD and gastric ulcers.", "20mg, 40mg"],
    ["Azithromycin", "Macrolide Antibiotic", "Broad-spectrum antibiotic for respiratory and bacterial infections.", "250mg, 500mg"],
    ["Metformin Hydrochloride", "Biguanide Antidiabetic", "First-line oral glycemic control for Type 2 Diabetes.", "500mg, 850mg, 1000mg"],
    ["Amlodipine Besylate", "Calcium Channel Blocker", "Antihypertensive for blood pressure and angina management.", "5mg, 10mg"],
    ["Montelukast Sodium", "Leukotriene Receptor Antagonist", "Maintenance therapy for asthma and allergic rhinitis.", "4mg, 10mg"],
  ];

  const genericIds = {};
  for (const [name, drugClass, desc, strengths] of genericData) {
    const norm = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const res = await client.query(
      `INSERT INTO generics (name, normalized_name, drug_class, description, common_strengths, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
       ON CONFLICT (normalized_name) DO UPDATE SET description = EXCLUDED.description
       RETURNING id`,
      [name, norm, drugClass, desc, strengths, userIds.pharm_harbor]
    );
    genericIds[name] = res.rows[0].id;
  }

  // 7. Seed Medicines scoped per Hospital + Pharmacy
  const medData = [
    [northstarId, harborPharmacyId, "Paracetamol (Acetaminophen)", "Napa Extend", "665mg", "Tablet", "Beximco Pharma", "10 tablets/strip", "HBR-NAP-665", 2500, "IN_STOCK"],
    [northstarId, harborPharmacyId, "Esomeprazole", "Sergel", "20mg", "Capsule", "Healthcare Pharma", "10 capsules/strip", "HBR-SRG-20", 7000, "IN_STOCK"],
    [northstarId, harborPharmacyId, "Azithromycin", "Zimax", "500mg", "Tablet", "Square Pharma", "6 tablets/box", "HBR-ZMX-500", 21000, "IN_STOCK"],
    [northstarId, harborPharmacyId, "Metformin Hydrochloride", "Comet", "500mg", "Tablet", "Square Pharma", "10 tablets/strip", "HBR-CMT-500", 4000, "LOW_STOCK"],
    [northstarId, harborPharmacyId, "Montelukast Sodium", "Monas", "10mg", "Tablet", "ACME Labs", "10 tablets/strip", "HBR-MNS-10", 16000, "IN_STOCK"],
    [crestviewId, crestPharmacyId, "Paracetamol (Acetaminophen)", "Ace Plus", "500mg", "Tablet", "Square Pharma", "10 tablets/strip", "CAP-ACE-500", 3000, "IN_STOCK"],
    [crestviewId, crestPharmacyId, "Amlodipine Besylate", "Amdocal", "5mg", "Tablet", "Beximco Pharma", "14 tablets/strip", "CAP-AMD-5", 7500, "IN_STOCK"],
    [crestviewId, crestPharmacyId, "Esomeprazole", "Maxpro", "40mg", "Capsule", "Renata Ltd", "10 capsules/strip", "CAP-MXP-40", 9500, "OUT_OF_STOCK"],
  ];

  const medIds = {};
  for (const [hospId, pharmId, genName, display, strength, form, mfr, pack, sku, price, avail] of medData) {
    const res = await client.query(
      `INSERT INTO medicines (
         hospital_id, pharmacy_id, generic_id, display_name, strength, dosage_form,
         manufacturer, pack_size, sku, unit_price_cents, currency, availability_status, created_by
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'BDT',$11,$12)
       ON CONFLICT (pharmacy_id, display_name, strength, dosage_form) DO UPDATE SET
         unit_price_cents = EXCLUDED.unit_price_cents,
         availability_status = EXCLUDED.availability_status
       RETURNING id`,
      [hospId, pharmId, genericIds[genName], display, strength, form, mfr, pack, sku, price, avail, userIds.pharm_harbor]
    );
    medIds[display] = res.rows[0].id;
  }

  // 8. Seed Sample Prescription (Accepted & Priced so patient can test sandbox payment immediately!)
  const rxRes = await client.query(
    `INSERT INTO prescriptions (
       prescription_number, patient_id, doctor_user_id, hospital_id, pharmacy_id,
       verification_method, status, clinical_notes, pharmacist_notes, pickup_instructions,
       pricing_confirmed, total_amount_cents, currency, issued_at, routed_at, accepted_at
     )
     VALUES (
       'RX-2026-100001', $1, $2, $3, $4,
       'GENERATOR_CODE', 'ACCEPTED',
       'Take after meals. Follow up in 14 days if symptoms persist.',
       'All prescribed items verified in stock at Harbor Pharmacy.',
       'Show RX-2026-100001 at Harbor Pharmacy Counter 2 after payment confirmation.',
       TRUE, 23000, 'BDT', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '30 minutes'
     )
     ON CONFLICT (prescription_number) DO NOTHING
     RETURNING id`,
    [patientId, userIds.dr_selina, northstarId, harborPharmacyId]
  );

  if (rxRes.rowCount > 0) {
    const rxId = rxRes.rows[0].id;
    await client.query(
      `INSERT INTO prescription_items (
         prescription_id, medicine_id, medicine_name, generic_name, strength, dosage_form,
         dose, route, frequency, duration, quantity, refills, instructions,
         availability_status, confirmed_unit_price_cents, line_total_cents
       ) VALUES
       ($1, $2, 'Sergel', 'Esomeprazole', '20mg', 'Capsule', '1 capsule', 'Oral', 'Once daily before breakfast', '14 days', 1, 0, 'Take 30 min before meal', 'AVAILABLE', 7000, 7000),
       ($1, $3, 'Monas', 'Montelukast Sodium', '10mg', 'Tablet', '1 tablet', 'Oral', 'Once nightly', '14 days', 1, 1, 'Take at bedtime', 'AVAILABLE', 16000, 16000)`,
      [rxId, medIds["Sergel"], medIds["Monas"]]
    );

    await client.query(
      `INSERT INTO notifications (user_id, hospital_id, category, title, body, action_url)
       VALUES ($1, $2, 'PRESCRIPTION', 'Prescription Confirmed by Harbor Pharmacy', 'Your prescription RX-2026-100001 has confirmed availability and pricing. Sign in to review and complete sandbox checkout.', '/patient')`,
      [userIds.patient_ayesha, northstarId]
    );
  }

  // 9. Genesis Audit Log Event
  const existingAudit = await client.query("SELECT id FROM audit_logs LIMIT 1");
  if (existingAudit.rowCount === 0) {
    const prevHash = "GENESIS";
    const payload = JSON.stringify({
      action: "SYSTEM_SEED",
      resourceType: "PLATFORM",
      outcome: "SUCCESS",
    });
    const eventHash = sha256(`${prevHash}|${payload}`);
    await client.query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, resource_type, resource_id, outcome, metadata, prev_hash, event_hash)
       VALUES ($1, 'PLATFORM_ADMIN', 'SYSTEM_SEED', 'PLATFORM', 'medora-pilot', 'SUCCESS', '{"note":"Initial pilot tenants seeded"}'::jsonb, $2, $3)`,
      [userIds.platform_admin, prevHash, eventHash]
    );
  }

  await client.query("COMMIT");

  console.log("\n=== Medora Pilot Seed Complete ===");
  console.log("Pilot Password (dev/sandbox only - change after first login):");
  console.log(`  ${seedPassword}`);
  console.log("Seeded Accounts:");
  console.log("  Platform Admin : platform.admin@medora.health (username: platform_admin)");
  console.log("  Hospital Admin : admin.northstar@medora.health (Northstar General)");
  console.log("  Hospital Admin : admin.crestview@medora.health (Crestview Medical Center)");
  console.log("  Doctor (Multi) : dr.selina@medora.health (Northstar + Crestview)");
  console.log("  Pharmacist     : pharm.harbor@medora.health (Harbor Pharmacy)");
  console.log("  Pharmacist     : pharm.crest@medora.health (Crestview Apothecary)");
  console.log("  Patient        : patient.demo@medora.health (username: patient_ayesha, UID: MED-PAT-100101)");
  console.log(`  Patient Generator Code (demo only): ${patientGeneratorCode}`);
} catch (err) {
  await client.query("ROLLBACK");
  console.error("Seed failed:", err);
  process.exit(1);
} finally {
  await client.end();
}
