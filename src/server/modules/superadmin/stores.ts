import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { platformDb } from "../../db/platform";
import { domains, storeMembers, stores, users } from "../../db/schema";
import { subquery } from "../../db/sql";

/**
 * Cross-store listing for the super-admin dashboard (platform connection).
 * Callers must have passed requireSuperAdmin().
 */
export async function listAllStores() {
  return platformDb
    .select({
      id: stores.id,
      name: stores.name,
      subdomain: stores.subdomain,
      billingStatus: stores.billingStatus,
      trialEndsAt: stores.trialEndsAt,
      adminSuspendedAt: stores.adminSuspendedAt,
      createdAt: stores.createdAt,
      ownerEmail: users.email,
      primaryDomain: subquery<string | null>(sql`
        SELECT ${domains.hostname} FROM ${domains}
        WHERE ${domains.storeId} = ${stores.id} AND ${domains.isPrimary} AND ${domains.status} = 'active'
        LIMIT 1`),
    })
    .from(stores)
    .leftJoin(storeMembers, and(eq(storeMembers.storeId, stores.id), eq(storeMembers.role, "owner")))
    .leftJoin(users, eq(users.id, storeMembers.userId))
    .orderBy(desc(stores.createdAt));
}
