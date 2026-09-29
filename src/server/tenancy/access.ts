/**
 * Single source of truth for what a store's owner and visitors may do, based on
 * billing state and admin suspension. Used by the proxy (storefront open/closed)
 * and the dashboard (full vs read-only).
 */

export type BillingStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";

export type StoreAccessInput = {
  billingStatus: BillingStatus;
  adminSuspended: boolean;
};

export type StoreAccess = {
  storefront: "open" | "closed";
  dashboard: "full" | "read_only";
  /** Why access is limited, for banners. null when everything is normal. */
  notice: null | "grace_period" | "billing_suspended" | "cancelled" | "admin_suspended";
};

export function getStoreAccess({ billingStatus, adminSuspended }: StoreAccessInput): StoreAccess {
  if (adminSuspended) return { storefront: "closed", dashboard: "read_only", notice: "admin_suspended" };
  switch (billingStatus) {
    case "trialing":
    case "active":
      return { storefront: "open", dashboard: "full", notice: null };
    case "past_due":
      // Inside the grace period: keep selling, nag the owner.
      return { storefront: "open", dashboard: "full", notice: "grace_period" };
    case "suspended":
      return { storefront: "closed", dashboard: "read_only", notice: "billing_suspended" };
    case "cancelled":
      return { storefront: "closed", dashboard: "read_only", notice: "cancelled" };
  }
}
