import "server-only";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { platformDb } from "../db/platform";
import { domains, stores } from "../db/schema";
import { getStoreAccess } from "./access";
import { createCachedResolver } from "./resolver-cache";
import type { ResolvedStore } from "./routing";

/*
 * Tenant lookups used by the proxy. These run on the PLATFORM connection because
 * the tenant is not known yet (that is what we are resolving). They return only
 * the minimum the proxy needs; pages load full store data inside withTenant().
 */

async function primaryHostFor(storeId: string): Promise<string | null> {
  const [row] = await platformDb
    .select({ hostname: domains.hostname })
    .from(domains)
    .where(and(eq(domains.storeId, storeId), eq(domains.isPrimary, true), eq(domains.status, "active")))
    .limit(1);
  return row?.hostname ?? null;
}

export async function loadStoreBySubdomain(subdomain: string): Promise<ResolvedStore | null> {
  const [row] = await platformDb
    .select({
      id: stores.id,
      subdomain: stores.subdomain,
      billingStatus: stores.billingStatus,
      adminSuspendedAt: stores.adminSuspendedAt,
    })
    .from(stores)
    .where(and(eq(stores.subdomain, subdomain), isNull(stores.deletedAt)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    subdomain: row.subdomain,
    primaryHost: await primaryHostFor(row.id),
    matchedHostname: null,
    storefrontOpen:
      getStoreAccess({ billingStatus: row.billingStatus, adminSuspended: row.adminSuspendedAt !== null }).storefront ===
      "open",
  };
}

export async function loadStoreByHostname(hostname: string): Promise<ResolvedStore | null> {
  // Exact hostname, or "www.<hostname>" when the domain opted into www.
  const [row] = await platformDb
    .select({
      id: stores.id,
      subdomain: stores.subdomain,
      billingStatus: stores.billingStatus,
      adminSuspendedAt: stores.adminSuspendedAt,
      hostname: domains.hostname,
    })
    .from(domains)
    .innerJoin(stores, eq(stores.id, domains.storeId))
    .where(
      and(
        eq(domains.status, "active"),
        isNull(stores.deletedAt),
        or(
          eq(domains.hostname, hostname),
          and(eq(domains.includeWww, true), eq(sql`'www.' || ${domains.hostname}`, hostname)),
        ),
      ),
    )
    // Prefer an exact match over a www match if both somehow exist.
    .orderBy(sql`(${domains.hostname} = ${hostname}) DESC`)
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    subdomain: row.subdomain,
    primaryHost: await primaryHostFor(row.id),
    matchedHostname: row.hostname,
    storefrontOpen:
      getStoreAccess({ billingStatus: row.billingStatus, adminSuspended: row.adminSuspendedAt !== null }).storefront ===
      "open",
  };
}

/**
 * Process-local cache in front of the loaders (60 s TTL, 15 s for misses).
 * On serverless each instance has its own cache, so a change (suspension,
 * new domain) can take up to 60 s to reach every instance. Code that changes
 * routing data should call invalidateStore() for the instance it runs on.
 */
export const storeResolver = createCachedResolver({
  bySubdomain: loadStoreBySubdomain,
  byHostname: loadStoreByHostname,
});

export const invalidateStore = storeResolver.invalidate;
