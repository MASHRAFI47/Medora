import "server-only";

function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minLength) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `FATAL: Missing or weak required server environment variable: ${name} (min ${minLength} chars)`
      );
    }
    return "";
  }
  if (
    process.env.NODE_ENV === "production" &&
    (value.includes("REPLACE_WITH") || value.includes("CHANGE_ME"))
  ) {
    throw new Error(`FATAL: Placeholder secret detected in production for ${name}`);
  }
  return value;
}

export const serverEnv = {
  get nodeEnv() {
    return process.env.NODE_ENV || "development";
  },
  get databaseUrl() {
    return requireEnv("DATABASE_URL", 10) || process.env.DATABASE_ADMIN_URL || "";
  },
  get nextAuthSecret() {
    const val = requireEnv("NEXTAUTH_SECRET", 32);
    if (!val && process.env.NODE_ENV !== "production") {
      return "dev-only-medora-nextauth-secret-please-set-env-local-32bytes";
    }
    return val;
  },
  get encryptionKeyHex() {
    const val = requireEnv("MEDORA_ENCRYPTION_KEY", 64);
    if (!val && process.env.NODE_ENV !== "production") {
      return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    }
    return val;
  },
  get csrfSecret() {
    const val = requireEnv("MEDORA_CSRF_SECRET", 32);
    if (!val && process.env.NODE_ENV !== "production") {
      return "dev-only-medora-csrf-secret-please-set-env-local-32bytes";
    }
    return val;
  },
  get allowedOrigins(): string[] {
    const raw = process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000";
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== "*");
  },
  get paymentMode(): "sandbox" {
    const mode = (process.env.PAYMENT_MODE || "sandbox").toLowerCase();
    if (mode !== "sandbox") {
      throw new Error("Live payment mode is disabled in pilot release; PAYMENT_MODE must be 'sandbox'.");
    }
    return "sandbox";
  },
  get stripeWebhookSecret() {
    return requireEnv("STRIPE_WEBHOOK_SECRET", 16) || "whsec_dev_sandbox_secret";
  },
  get bkashWebhookSecret() {
    return requireEnv("BKASH_WEBHOOK_SECRET", 16) || "bkash_whsec_dev_sandbox_secret";
  },
  get bkashSandboxBaseUrl() {
    return process.env.BKASH_SANDBOX_BASE_URL || "https://tokenized.sandbox.bka.sh/v1.2.0-beta";
  },
};
