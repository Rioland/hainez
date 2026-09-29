import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantPolicy, updatedAt } from "./_shared";
import { domainKind, domainStatus, registrarKind } from "./enums";
import { stores } from "./stores";

/**
 * Custom domains attached to a store. Stage 1 only reads this table (tenant
 * resolution by hostname); purchase/verification flows arrive in Stage 8.
 */
export const domains = pgTable(
  "domains",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** Lowercase, punycode. Apex (acme.com) or subdomain (shop.acme.com). */
    hostname: text("hostname").notNull(),
    kind: domainKind("kind").notNull(),
    status: domainStatus("status").notNull(),
    registrar: registrarKind("registrar").notNull(),
    /** Registrar-side id (e.g. Hostinger subscription id). */
    registrarRef: text("registrar_ref"),
    /** Primary domain: other hosts for this store 301 here. */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Also serve www.<hostname> (redirected to the primary host). */
    includeWww: boolean("include_www").notNull().default(true),
    /** Value the owner puts in a TXT record to prove ownership. */
    verificationToken: text("verification_token").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    dnsLastCheckedAt: timestamp("dns_last_checked_at", { withTimezone: true }),
    dnsCheckAttempts: integer("dns_check_attempts").notNull().default(0),
    lastError: text("last_error"),
    registeredAt: timestamp("registered_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    autoRenew: boolean("auto_renew").notNull().default(true),
    sslReadyAt: timestamp("ssl_ready_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Lets child tables use composite FKs (store_id, domain_id) in later stages.
    unique("domains_store_id_id_key").on(t.storeId, t.id),
    check(
      "domains_hostname_check",
      sql`${t.hostname} ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z0-9-]{2,63}$'`,
    ),
    // A hostname can belong to only one store at a time; removed rows free it.
    uniqueIndex("domains_hostname_live").on(t.hostname).where(sql`status <> 'removed'`),
    uniqueIndex("domains_one_primary").on(t.storeId).where(sql`is_primary`),
    index("domains_work_queue")
      .on(t.status, t.dnsLastCheckedAt)
      .where(sql`status IN ('registering', 'dns_pending')`),
    tenantPolicy(),
  ],
);
