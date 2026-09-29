import { Client } from "pg";
import { runMigrations } from "../../scripts/migrate";

/**
 * Integration tests run against a real Postgres (RLS can't be mocked).
 * Before the run: wipe the test database's schemas and apply all migrations
 * as the app's (non-superuser) owner role, exactly like production.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://msb_owner:msb_owner@localhost:5432/msb_test";
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Integration tests need Postgres at ${url}.\nStart it with: docker compose -f docker-compose.dev.yml up -d\n${String(err)}`,
    );
  }
  await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.end();

  await runMigrations(url, () => {});
}
