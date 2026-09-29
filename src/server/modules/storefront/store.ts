import "server-only";
import { cache } from "react";
import { stores } from "../../db/schema";
import { withTenant } from "../../db/tenant";

/**
 * The storefront's own store row, read under the tenant role (RLS) — the
 * storefront never needs the platform connection.
 *
 * Stage 3/4 will wrap this in 'use cache' + cacheTag(`store:${id}`) and add
 * theme data; for Stage 1 it is deduplicated per request only.
 */
export const getStorefrontStore = cache(async (storeId: string) =>
  withTenant(storeId, async (tx) => {
    const [row] = await tx
      .select({
        id: stores.id,
        name: stores.name,
        subdomain: stores.subdomain,
        currency: stores.currency,
        contactEmail: stores.contactEmail,
        contactPhone: stores.contactPhone,
        billingStatus: stores.billingStatus,
        adminSuspendedAt: stores.adminSuspendedAt,
      })
      .from(stores);
    return row ?? null;
  }),
);
