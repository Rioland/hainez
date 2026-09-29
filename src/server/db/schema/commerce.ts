import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { citext, createdAt, id, tenantPolicy, updatedAt } from "./_shared";
import { actorType, orderStatus } from "./enums";
import { stores } from "./stores";

/*
 * Customers, shipping and orders. Customer accounts/login, carts and checkout
 * arrive in Stage 3; Stage 2 is the admin side.
 */

export type Address = {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode?: string;
  country: string;
};

export const shippingMethods = pgTable(
  "shipping_methods",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    freeOverMinor: bigint("free_over_minor", { mode: "number" }),
    /** Nigerian state codes (e.g. "LA", "FC"); empty = ships everywhere. */
    regions: text("regions").array().notNull().default(sql`'{}'::text[]`),
    minDays: smallint("min_days"),
    maxDays: smallint("max_days"),
    isActive: boolean("is_active").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("shipping_methods_store_id_id_key").on(t.storeId, t.id),
    check("shipping_methods_price_check", sql`${t.priceMinor} >= 0`),
    check("shipping_methods_free_over_check", sql`${t.freeOverMinor} IS NULL OR ${t.freeOverMinor} >= 0`),
    check("shipping_methods_days_check", sql`${t.minDays} IS NULL OR ${t.maxDays} IS NULL OR ${t.minDays} <= ${t.maxDays}`),
    tenantPolicy(),
  ],
);

/** Customers belong to exactly one store: the same email on two stores = two customers. */
export const customers = pgTable(
  "customers",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    name: text("name"),
    phone: text("phone"),
    /** NULL = guest checkout customer (accounts arrive in Stage 3). */
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    acceptsMarketing: boolean("accepts_marketing").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("customers_store_id_id_key").on(t.storeId, t.id),
    unique("customers_store_email_key").on(t.storeId, t.email),
    tenantPolicy(),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** Human-friendly per-store number, from stores.next_order_number. */
    orderNumber: integer("order_number").notNull(),
    customerId: uuid("customer_id"), // FK in 0004
    email: citext("email").notNull(),
    phone: text("phone"),
    status: orderStatus("status").notNull().default("pending"),
    currency: char("currency", { length: 3 }).notNull(),
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    shippingMinor: bigint("shipping_minor", { mode: "number" }).notNull().default(0),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    taxMinor: bigint("tax_minor", { mode: "number" }).notNull().default(0),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    shippingMethodId: uuid("shipping_method_id"), // FK in 0004
    shippingMethodName: text("shipping_method_name"),
    shippingAddress: jsonb("shipping_address").$type<Address>().notNull(),
    billingAddress: jsonb("billing_address").$type<Address>(),
    customerNote: text("customer_note"),
    internalNote: text("internal_note"),
    /** Provider + reference arrive with checkout (Stage 3/7). */
    paymentProvider: text("payment_provider"),
    paymentReference: text("payment_reference"),
    /** Stock was decremented for this order (exactly once). */
    inventoryCommitted: boolean("inventory_committed").notNull().default(false),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    trackingNumber: text("tracking_number"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("orders_store_id_id_key").on(t.storeId, t.id),
    unique("orders_store_number_key").on(t.storeId, t.orderNumber),
    check(
      "orders_total_check",
      sql`${t.totalMinor} = ${t.subtotalMinor} + ${t.shippingMinor} + ${t.taxMinor} - ${t.discountMinor}`,
    ),
    check(
      "orders_amounts_check",
      sql`${t.subtotalMinor} >= 0 AND ${t.shippingMinor} >= 0 AND ${t.discountMinor} >= 0 AND ${t.taxMinor} >= 0 AND ${t.totalMinor} >= 0`,
    ),
    index("orders_listing").on(t.storeId, t.status, t.createdAt.desc()),
    index("orders_customer").on(t.storeId, t.customerId, t.createdAt.desc()),
    index("orders_created").on(t.storeId, t.createdAt.desc()),
    tenantPolicy(),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    storeId: uuid("store_id").notNull(),
    orderId: uuid("order_id").notNull(),
    productId: uuid("product_id"), // FK in 0004
    variantId: uuid("variant_id"), // FK in 0004
    // Snapshots: order history survives product edits and deletes.
    productTitle: text("product_title").notNull(),
    variantTitle: text("variant_title"),
    sku: text("sku"),
    imageUrl: text("image_url"),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalMinor: bigint("line_total_minor", { mode: "number" }).notNull(),
  },
  (t) => [
    unique("order_items_store_id_id_key").on(t.storeId, t.id),
    foreignKey({ columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete("cascade"),
    check("order_items_quantity_check", sql`${t.quantity} > 0`),
    check("order_items_price_check", sql`${t.unitPriceMinor} >= 0`),
    check("order_items_total_check", sql`${t.lineTotalMinor} = ${t.unitPriceMinor} * ${t.quantity}`),
    index("order_items_order").on(t.storeId, t.orderId),
    index("order_items_product").on(t.storeId, t.productId),
    tenantPolicy(),
  ],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: id(),
    storeId: uuid("store_id").notNull(),
    orderId: uuid("order_id").notNull(),
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status").notNull(),
    note: text("note"),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.storeId, t.orderId], foreignColumns: [orders.storeId, orders.id] }).onDelete("cascade"),
    index("order_status_history_order").on(t.storeId, t.orderId, t.createdAt),
    tenantPolicy(),
  ],
);
