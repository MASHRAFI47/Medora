import "server-only";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { serverEnv } from "@/lib/env";
import { querySystem } from "@/lib/db";
import { decryptText, verifySecret } from "@/lib/security/crypto";
import { verifyTotpCode } from "@/lib/security/totp";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { recordAuditEvent } from "@/lib/security/audit";
import { logger } from "@/lib/security/logger";
import type { MedoraRole } from "@/types/next-auth";

interface DbUserRow {
  id: string;
  email: string | null;
  username: string;
  full_name: string;
  password_hash: string | null;
  primary_role: MedoraRole;
  account_status: string;
  must_change_password: boolean;
  mfa_enabled: boolean;
  mfa_secret_encrypted: string | null;
  mfa_recovery_hashes: string[];
  active_hospital_id: string | null;
  active_pharmacy_id: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export const authOptions: NextAuthOptions = {
  secret: serverEnv.nextAuthSecret,
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours clinical session lifetime
    updateAge: 30 * 60,
  },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/signin",
  },
  cookies: {
    sessionToken: {
      name:
        serverEnv.nodeEnv === "production"
          ? "__Secure-medora.session-token"
          : "medora.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: serverEnv.nodeEnv === "production",
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: "Medora Credentials",
      credentials: {
        identifier: { label: "Email or Username", type: "text" },
        password: { label: "Password", type: "password" },
        totpCode: { label: "Authenticator Code (if MFA enabled)", type: "text" },
      },
      async authorize(credentials) {
        const identifier = credentials?.identifier?.trim().toLowerCase() ?? "";
        const password = credentials?.password ?? "";
        const totpCode = credentials?.totpCode?.trim() ?? "";

        if (!identifier || !password) {
          throw new Error("Please enter your credentials.");
        }

        const rl = await checkRateLimit(`auth:login:${identifier}`, 12, 300);
        if (!rl.allowed) {
          throw new Error(
            `Too many sign-in attempts. Please wait ${rl.retryAfterSeconds} seconds.`
          );
        }

        const res = await querySystem<DbUserRow>(
          `SELECT id, email, username, full_name, password_hash, primary_role,
                  account_status, must_change_password, mfa_enabled,
                  mfa_secret_encrypted, mfa_recovery_hashes,
                  active_hospital_id, active_pharmacy_id,
                  failed_login_attempts, locked_until
           FROM users
           WHERE LOWER(email) = $1 OR LOWER(username) = $1
           LIMIT 1`,
          [identifier]
        );

        const user = res.rows[0];
        if (!user) {
          await recordAuditEvent({
            action: "AUTH_LOGIN_FAILED",
            resourceType: "USER",
            outcome: "FAILURE",
            metadata: { reason: "INVALID_CREDENTIALS" },
          });
          throw new Error("Invalid email/username or password.");
        }

        if (user.account_status === "SUSPENDED") {
          await recordAuditEvent({
            actorUserId: user.id,
            actorRole: user.primary_role,
            action: "AUTH_LOGIN_SUSPENDED",
            resourceType: "USER",
            resourceId: user.id,
            outcome: "DENIED",
          });
          throw new Error("Your account is suspended. Contact your administrator.");
        }

        if (user.account_status === "PENDING_ACTIVATION" || !user.password_hash) {
          throw new Error("Account activation required. Use your one-time activation code first.");
        }

        if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
          throw new Error("Account temporarily locked due to repeated failed attempts. Try again later.");
        }

        const passwordOk = verifySecret(password, user.password_hash);
        if (!passwordOk) {
          const nextAttempts = user.failed_login_attempts + 1;
          const lockClause =
            nextAttempts >= MAX_FAILED_ATTEMPTS
              ? `NOW() + INTERVAL '${LOCKOUT_MINUTES} minutes'`
              : "NULL";
          await querySystem(
            `UPDATE users
             SET failed_login_attempts = $1,
                 locked_until = ${lockClause},
                 updated_at = NOW()
             WHERE id = $2`,
            [nextAttempts, user.id]
          );
          await recordAuditEvent({
            actorUserId: user.id,
            actorRole: user.primary_role,
            action: "AUTH_LOGIN_FAILED",
            resourceType: "USER",
            resourceId: user.id,
            outcome: "FAILURE",
            metadata: { attempts: nextAttempts },
          });
          throw new Error("Invalid email/username or password.");
        }

        // Enforce TOTP MFA when enabled on the user account
        let mfaVerified = !user.mfa_enabled;
        if (user.mfa_enabled) {
          if (!totpCode) {
            throw new Error("MFA_REQUIRED");
          }
          let validMfa = false;
          if (user.mfa_secret_encrypted) {
            const secretBase32 = decryptText(user.mfa_secret_encrypted);
            validMfa = verifyTotpCode(secretBase32, totpCode);
          }
          // Fallback: check single-use recovery codes
          if (!validMfa && Array.isArray(user.mfa_recovery_hashes)) {
            const matchIdx = user.mfa_recovery_hashes.findIndex((h) =>
              verifySecret(totpCode.toUpperCase(), h)
            );
            if (matchIdx !== -1) {
              validMfa = true;
              const remaining = user.mfa_recovery_hashes.filter((_, idx) => idx !== matchIdx);
              await querySystem(
                "UPDATE users SET mfa_recovery_hashes = $1::jsonb, updated_at = NOW() WHERE id = $2",
                [JSON.stringify(remaining), user.id]
              );
            }
          }
          if (!validMfa) {
            await recordAuditEvent({
              actorUserId: user.id,
              actorRole: user.primary_role,
              action: "AUTH_MFA_FAILED",
              resourceType: "USER",
              resourceId: user.id,
              outcome: "FAILURE",
            });
            throw new Error("Invalid authenticator or recovery code.");
          }
          mfaVerified = true;
        }

        await querySystem(
          "UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1",
          [user.id]
        );

        await recordAuditEvent({
          actorUserId: user.id,
          actorRole: user.primary_role,
          hospitalId: user.active_hospital_id,
          action: "AUTH_LOGIN_SUCCESS",
          resourceType: "USER",
          resourceId: user.id,
          outcome: "SUCCESS",
          metadata: { mfaUsed: user.mfa_enabled },
        });
        logger.info("auth.login.success", { userId: user.id, role: user.primary_role });

        return {
          id: user.id,
          email: user.email,
          name: user.full_name,
          username: user.username,
          role: user.primary_role,
          accountStatus: user.account_status,
          activeHospitalId: user.active_hospital_id,
          activePharmacyId: user.active_pharmacy_id,
          mfaEnabled: user.mfa_enabled,
          mfaVerified,
          mustChangePassword: user.must_change_password,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.username = user.username;
        token.role = user.role;
        token.accountStatus = user.accountStatus;
        token.activeHospitalId = user.activeHospitalId;
        token.activePharmacyId = user.activePharmacyId;
        token.mfaEnabled = user.mfaEnabled;
        token.mfaVerified = user.mfaVerified;
        token.mustChangePassword = user.mustChangePassword;
        return token;
      }

      // Refresh live role/status/context from PostgreSQL so suspensions & hospital switches take effect immediately
      if (token.id) {
        try {
          const res = await querySystem<{
            username: string;
            full_name: string;
            primary_role: MedoraRole;
            account_status: string;
            active_hospital_id: string | null;
            active_pharmacy_id: string | null;
            mfa_enabled: boolean;
            must_change_password: boolean;
          }>(
            `SELECT username, full_name, primary_role, account_status,
                    active_hospital_id, active_pharmacy_id, mfa_enabled, must_change_password
             FROM users WHERE id = $1 LIMIT 1`,
            [token.id]
          );
          const fresh = res.rows[0];
          if (fresh) {
            token.username = fresh.username;
            token.name = fresh.full_name;
            token.role = fresh.primary_role;
            token.accountStatus = fresh.account_status;
            token.activeHospitalId = fresh.active_hospital_id;
            token.activePharmacyId = fresh.active_pharmacy_id;
            token.mfaEnabled = fresh.mfa_enabled;
            token.mustChangePassword = fresh.must_change_password;
          }
        } catch {
          // Keep existing token values on transient DB hiccup
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: token.id,
        email: token.email,
        name: token.name,
        username: token.username,
        role: token.role,
        accountStatus: token.accountStatus,
        activeHospitalId: token.activeHospitalId,
        activePharmacyId: token.activePharmacyId,
        mfaEnabled: token.mfaEnabled,
        mfaVerified: token.mfaVerified,
        mustChangePassword: token.mustChangePassword,
      };
      return session;
    },
  },
};
