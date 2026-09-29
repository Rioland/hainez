import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit only *generates* SQL here (`pnpm db:generate`), which needs no
 * database. Migrations are applied by scripts/migrate.ts, which also syncs
 * tenant grants and asserts every tenant table has RLS.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
