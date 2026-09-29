import { pgEnum } from "drizzle-orm/pg-core";

export const platformRole = pgEnum("platform_role", ["user", "super_admin"]);

export const storeMemberRole = pgEnum("store_member_role", ["owner", "admin", "staff"]);

/**
 * Billing lifecycle, mirrored on stores.billing_status for fast tenant lookup:
 *   trialing -> active -> past_due (grace) -> suspended -> (paid) active
 *   cancelled = owner ended the subscription / store closed
 */
export const billingStatus = pgEnum("billing_status", ["trialing", "active", "past_due", "suspended", "cancelled"]);

export const domainKind = pgEnum("domain_kind", ["purchased", "external"]);

/**
 * Purchased: pending_payment -> registering -> dns_pending -> active | failed
 * External : dns_pending (waiting for the owner's DNS + TXT) -> active | failed
 */
export const domainStatus = pgEnum("domain_status", [
  "pending_payment",
  "registering",
  "dns_pending",
  "active",
  "failed",
  "expired",
  "removed",
]);

export const registrarKind = pgEnum("registrar_kind", ["hostinger", "manual", "external"]);

export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);

/** Order lifecycle. Allowed transitions live in src/server/modules/orders/transitions.ts. */
export const orderStatus = pgEnum("order_status", ["pending", "paid", "shipped", "delivered", "cancelled"]);

export const actorType = pgEnum("actor_type", ["user", "super_admin", "customer", "system"]);
