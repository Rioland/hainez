import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { platformDb } from "../db/platform";
import { storeMembers, stores } from "../db/schema";

/*
 * Cross-store membership lookups. These must run on the platform connection
 * (a user can belong to several stores, so no single tenant applies).
 */

export type StoreRole = "owner" | "admin" | "staff";

const ROLE_RANK: Record<StoreRole, number> = { staff: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: StoreRole, min: StoreRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function listStoresForUser(userId: string) {
  return platformDb
    .select({
      id: stores.id,
      name: stores.name,
      subdomain: stores.subdomain,
      billingStatus: stores.billingStatus,
      trialEndsAt: stores.trialEndsAt,
      adminSuspendedAt: stores.adminSuspendedAt,
      role: storeMembers.role,
    })
    .from(storeMembers)
    .innerJoin(stores, eq(stores.id, storeMembers.storeId))
    .where(and(eq(storeMembers.userId, userId), isNull(stores.deletedAt)))
    .orderBy(asc(stores.name));
}

export async function findMembership(subdomain: string, userId: string) {
  const [row] = await platformDb
    .select({
      storeId: stores.id,
      name: stores.name,
      subdomain: stores.subdomain,
      billingStatus: stores.billingStatus,
      trialEndsAt: stores.trialEndsAt,
      adminSuspendedAt: stores.adminSuspendedAt,
      role: storeMembers.role,
    })
    .from(stores)
    .innerJoin(storeMembers, and(eq(storeMembers.storeId, stores.id), eq(storeMembers.userId, userId)))
    .where(and(eq(stores.subdomain, subdomain), isNull(stores.deletedAt)))
    .limit(1);
  return row ?? null;
}
