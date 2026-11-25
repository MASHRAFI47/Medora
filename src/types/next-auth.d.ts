import "next-auth";
import "next-auth/jwt";

export type MedoraRole =
  | "PLATFORM_ADMIN"
  | "HOSPITAL_ADMIN"
  | "DOCTOR"
  | "PHARMACIST"
  | "PATIENT";

declare module "next-auth" {
  interface User {
    id: string;
    email?: string | null;
    name?: string | null;
    username: string;
    role: MedoraRole;
    accountStatus: string;
    activeHospitalId: string | null;
    activePharmacyId: string | null;
    mfaEnabled: boolean;
    mfaVerified: boolean;
    mustChangePassword: boolean;
  }

  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      username: string;
      role: MedoraRole;
      accountStatus: string;
      activeHospitalId: string | null;
      activePharmacyId: string | null;
      mfaEnabled: boolean;
      mfaVerified: boolean;
      mustChangePassword: boolean;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    username: string;
    role: MedoraRole;
    accountStatus: string;
    activeHospitalId: string | null;
    activePharmacyId: string | null;
    mfaEnabled: boolean;
    mfaVerified: boolean;
    mustChangePassword: boolean;
  }
}
