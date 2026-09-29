import "server-only";
import { sql } from "drizzle-orm";
import { platformDb, type PlatformTx } from "./platform";

declare const tenantBrand: unique symbol;

/**
 * A transaction that is locked to one store. Obtainable only from withTenant(),
 * so repository functions that accept a TenantTx cannot be called without a
 * tenant context.
 */
export type TenantTx = PlatformTx & { readonly [tenantBrand]: true };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` inside a transaction scoped to `storeId`.
 *
 * Two things happen before `fn` runs, both transaction-local (so they are safe
 * with pgbouncer/Neon transaction pooling and vanish on COMMIT/ROLLBACK):
 *   1. SET LOCAL ROLE app_tenant  -> row-level security applies from here on
 *   2. app.store_id = storeId     -> RLS policies only match this store's rows
 *
 * Application code should still filter by store_id for clarity and index use;
 * RLS is the safety net that turns a forgotten filter into "0 rows" instead of
 * another store's data.
 */
export async function withTenant<T>(storeId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(storeId)) {
    throw new Error(`withTenant: invalid store id "${storeId}"`);
  }
  return platformDb.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('role', 'app_tenant', true), set_config('app.store_id', ${storeId}, true)`,
    );
    return fn(tx as TenantTx);
  });
}
