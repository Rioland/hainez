import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, createdAt, id, tenantPolicy, updatedAt } from "./_shared";
import { users } from "./auth";
import { billingStatus, storeMemberRole } from "./enums";

/** The tenant. Every tenant-owned row in the system points back here via store_id. */
export const stores = pgTable(
  "stores",
  {
    id: id(),
    name: text("name").notNull(),
    /** 3-63 chars, lowercase letters/digits/hyphens, no leading/trailing hyphen. */
    subdomain: text("subdomain").notNull().unique(),
    /** Denormalised from subscriptions (Stage 6) so tenant resolution is one indexed read. */
    billingStatus: billingStatus("billing_status").notNull().default("trialing"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull(),
    /** Super-admin suspension, independent of billing. */
    adminSuspendedAt: timestamp("admin_suspended_at", { withTimezone: true }),
    adminSuspendedReason: text("admin_suspended_reason"),
    currency: char("currency", { length: 3 }).notNull().default("NGN"),
    timezone: text("timezone").notNull().default("Africa/Lagos"),
    contactEmail: citext("contact_email"),
    contactPhone: text("contact_phone"),
    address: jsonb("address"),
    seo: jsonb("seo").notNull().default({}),
    /** {"logo":false,"colours":false,"first_product":false} */
    onboarding: jsonb("onboarding").notNull().default({}),
    /** Next human-readable order number for this store. */
    nextOrderNumber: integer("next_order_number").notNull().default(1001),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check("stores_name_check", sql`char_length(${t.name}) BETWEEN 2 AND 80`),
    check("stores_subdomain_check", sql`${t.subdomain} ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'`),
    // A tenant can see only its own store row.
    tenantPolicy("id"),
  ],
);

export const storeMembers = pgTable(
  "store_members",
  {
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: storeMemberRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.userId] }),
    // Exactly one owner per store.
    uniqueIndex("store_members_one_owner").on(t.storeId).where(sql`role = 'owner'`),
    index("store_members_user_idx").on(t.userId),
    tenantPolicy(),
  ],
);
