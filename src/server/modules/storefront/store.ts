import "server-only";
import { cache } from "react";
import { stores } from "../../db/schema";
import { withTenant } from "../../db/tenant";

/**
 * Live (uncached) read of the store's billing/suspension state, for the
 * "temporarily unavailable" page. Catalog pages use the cached getPublicStore
 * in ./catalog instead.
 */
export const getStorefrontStore = cache(async (storeId: string) =>
  withTenant(storeId, async (tx) => {
    const [row] = await tx
      .select({
        id: stores.id,
        name: stores.name,
        billingStatus: stores.billingStatus,
        adminSuspendedAt: stores.adminSuspendedAt,
      })
      .from(stores);
    return row ?? null;
  }),
);
