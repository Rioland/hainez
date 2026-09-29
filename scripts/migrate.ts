/**
 * Apply migrations, then:
 *   1. sync app_tenant grants for every table with a tenant_isolation policy
 *   2. assert every table with a store_id column has row-level security
 *
 * Usage: pnpm db:migrate   (reads .env; uses DATABASE_URL_UNPOOLED if set)
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

export async function runMigrations(connectionString: string, log: (msg: string) => void = console.log) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: "./drizzle" });
    log("✓ migrations applied");
    await client.query("SELECT app_sync_tenant_grants()");
    log("✓ tenant grants synced");
    await client.query("SELECT app_assert_tenant_rls()");
    log("✓ every tenant table has row-level security");
  } finally {
    await client.end();
  }
}

// Run when executed directly (not when imported by the test setup).
if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (see .env.example)");
    process.exit(1);
  }
  runMigrations(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
