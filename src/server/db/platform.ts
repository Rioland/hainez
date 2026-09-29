import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

/**
 * PLATFORM connection. Runs as the database owner role, which is NOT subject to
 * row-level security, so it can see every store.
 *
 * Only a short allowlist of modules may import this (enforced by ESLint, see
 * eslint.config.mjs): tenancy resolution, auth, super-admin, billing webhooks and
 * background jobs. Everything store-scoped must go through withTenant() instead.
 */

const globalForDb = globalThis as unknown as { __msbPool?: Pool };

// Reuse one pool across hot reloads in dev. On Vercel each function instance
// gets its own small pool; DATABASE_URL should be the pooled (pgbouncer) URL.
export const pool =
  globalForDb.__msbPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: env.NODE_ENV === "production" ? 5 : 10,
    idleTimeoutMillis: 10_000,
  });

if (env.NODE_ENV !== "production") globalForDb.__msbPool = pool;

export const platformDb = drizzle(pool, { schema });

export type PlatformDb = typeof platformDb;
export type PlatformTx = Parameters<Parameters<PlatformDb["transaction"]>[0]>[0];
