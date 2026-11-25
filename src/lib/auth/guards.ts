import "server-only";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth/options";
import { querySystem, type RlsContext } from "@/lib/db";
import { verifyCsrfRequest } from "@/lib/security/csrf";
import type { MedoraRole } from "@/types/next-auth";

export interface AuthContext {
  userId: string;
  username: string;
  fullName: string;
  role: MedoraRole;
  accountStatus: string;
  activeHospitalId: string | null;
  activePharmacyId: string | null;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
  rls: RlsContext;
}

export interface GuardOptions {
  roles?: MedoraRole[];
  requireActiveHospital?: boolean;
  requireActivePharmacy?: boolean;
  skipCsrf?: boolean;
}

/**
 * Centralized server-side authentication, RBAC, CSRF, and active tenant membership guard.
 * Never relies on client-side checks or hidden UI elements.
 */
export async function requireApiAuth(
  req: NextRequest,
  options: GuardOptions = {}
): Promise<{ ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }> {
  if (!options.skipCsrf) {
    const csrf = verifyCsrfRequest(req);
    if (!csrf.ok) {
      return {
        ok: false,
        response: NextResponse.json({ error: csrf.reason || "CSRF validation failed." }, { status: 403 }),
      };
    }
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
    };
  }

  if (session.user.accountStatus === "SUSPENDED") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Account is suspended." }, { status: 403 }),
    };
  }

  if (session.user.mfaEnabled && !session.user.mfaVerified) {
    return {
      ok: false,
      response: NextResponse.json({ error: "MFA verification required." }, { status: 403 }),
    };
  }

  if (options.roles && !options.roles.includes(session.user.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Insufficient permissions for this resource." }, { status: 403 }),
    };
  }

  let verifiedHospitalId = session.user.activeHospitalId;
  let verifiedPharmacyId = session.user.activePharmacyId;

  // Enforce server-side hospital/pharmacy membership approval for clinical/admin staff
  if (
    options.requireActiveHospital ||
    options.requireActivePharmacy ||
    ["HOSPITAL_ADMIN", "DOCTOR", "PHARMACIST"].includes(session.user.role)
  ) {
    if (session.user.role !== "PLATFORM_ADMIN" && session.user.role !== "PATIENT") {
      if (verifiedHospitalId) {
        const memRes = await querySystem<{
          hospital_id: string;
          pharmacy_id: string | null;
          verification_status: string;
          license_expires_at: string | null;
          hospital_status: string;
        }>(
          `SELECT hm.hospital_id, hm.pharmacy_id, hm.verification_status, hm.license_expires_at,
                  h.status AS hospital_status
           FROM hospital_memberships hm
           JOIN hospitals h ON h.id = hm.hospital_id
           WHERE hm.user_id = $1 AND hm.hospital_id = $2 AND hm.role = $3
           LIMIT 1`,
          [session.user.id, verifiedHospitalId, session.user.role]
        );
        const mem = memRes.rows[0];
        const licenseExpired =
          mem?.license_expires_at && new Date(mem.license_expires_at).getTime() < Date.now();
        if (
          !mem ||
          mem.verification_status !== "APPROVED" ||
          mem.hospital_status !== "ACTIVE" ||
          licenseExpired
        ) {
          verifiedHospitalId = null;
          verifiedPharmacyId = null;
        } else if (session.user.role === "PHARMACIST") {
          verifiedPharmacyId = mem.pharmacy_id;
        }
      }

      if (options.requireActiveHospital && !verifiedHospitalId) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error:
                "An approved, active hospital workspace context is required. Select a verified hospital or await administrator approval.",
            },
            { status: 403 }
          ),
        };
      }

      if (options.requireActivePharmacy && !verifiedPharmacyId) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error:
                "An approved pharmacy assignment within your active hospital is required for this operation.",
            },
            { status: 403 }
          ),
        };
      }
    }
  }

  const ctx: AuthContext = {
    userId: session.user.id,
    username: session.user.username,
    fullName: session.user.name || session.user.username,
    role: session.user.role,
    accountStatus: session.user.accountStatus,
    activeHospitalId: verifiedHospitalId,
    activePharmacyId: verifiedPharmacyId,
    mfaEnabled: session.user.mfaEnabled,
    mustChangePassword: session.user.mustChangePassword,
    rls: {
      userId: session.user.id,
      userRole: session.user.role,
      hospitalId: verifiedHospitalId,
      pharmacyId: verifiedPharmacyId,
      bypassRls: false,
    },
  };

  return { ok: true, ctx };
}

export async function getServerAuthContext(): Promise<AuthContext | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.accountStatus === "SUSPENDED") return null;

  return {
    userId: session.user.id,
    username: session.user.username,
    fullName: session.user.name || session.user.username,
    role: session.user.role,
    accountStatus: session.user.accountStatus,
    activeHospitalId: session.user.activeHospitalId,
    activePharmacyId: session.user.activePharmacyId,
    mfaEnabled: session.user.mfaEnabled,
    mustChangePassword: session.user.mustChangePassword,
    rls: {
      userId: session.user.id,
      userRole: session.user.role,
      hospitalId: session.user.activeHospitalId,
      pharmacyId: session.user.activePharmacyId,
      bypassRls: false,
    },
  };
}
