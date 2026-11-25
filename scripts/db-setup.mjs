import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(rootDir, ".env.local") });
dotenv.config({ path: path.join(rootDir, ".env") });

const adminUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
if (!adminUrl) {
  console.error("Missing DATABASE_ADMIN_URL or DATABASE_URL in .env.local");
  process.exit(1);
}

const parsed = new URL(adminUrl);
const dbName = parsed.pathname.replace(/^\//, "") || "medora";

async function ensureDatabase() {
  const maintUrl = new URL(adminUrl);
  maintUrl.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintUrl.toString() });
  try {
    await client.connect();
    const exists = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    if (exists.rowCount === 0) {
      if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
        throw new Error(`Unsafe database name: ${dbName}`);
      }
      await client.query(`CREATE DATABASE ${dbName}`);
      console.log(`Created database "${dbName}"`);
    } else {
      console.log(`Database "${dbName}" already exists`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function runMigrations() {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const migrationsDir = path.join(rootDir, "db", "migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Applying migration: ${file}`);
      await client.query(sql);
    }

    // Create least-privilege non-superuser role `medora_app` so RLS is strictly enforced
    const appPassword = process.env.MEDORA_APP_DB_PASSWORD;
    if (appPassword && appPassword.length >= 16) {
      const roleExists = await client.query(
        "SELECT 1 FROM pg_roles WHERE rolname = 'medora_app'"
      );
      if (roleExists.rowCount === 0) {
        await client.query(
          `CREATE ROLE medora_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${appPassword.replace(/'/g, "''")}'`
        );
        console.log("Created least-privilege RLS role: medora_app");
      } else {
        await client.query(
          `ALTER ROLE medora_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${appPassword.replace(/'/g, "''")}'`
        );
        console.log("Updated least-privilege RLS role: medora_app");
      }
      await client.query(`GRANT CONNECT ON DATABASE ${dbName} TO medora_app`);
      await client.query("GRANT USAGE ON SCHEMA public TO medora_app");
      await client.query(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO medora_app"
      );
      await client.query(
        "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medora_app"
      );
      await client.query(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO medora_app"
      );
      await client.query(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO medora_app"
      );
      // Prevent audit log tampering (append-only for app role)
      await client.query("REVOKE UPDATE, DELETE ON audit_logs FROM medora_app");
      console.log("Granted least-privilege permissions and locked audit_logs as append-only");
    }

    console.log("Database setup complete.");
  } finally {
    await client.end();
  }
}

await ensureDatabase();
await runMigrations();
