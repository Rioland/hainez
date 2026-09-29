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
 * Customers, shipping, carts and orders. Customers belong to one store; their
 * sessions and carts are scoped to that store's host (see storefront modules).
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
    /** NULL = guest checkout customer (no account). */
    passwordHash: text("password_hash"),
    /**
     * When the customer set a password. Until their email is verified (Stage 10),
     * their account only shows orders placed after this moment, so registering
     * with someone else's email can't reveal that person's past guest orders.
     */
    accountCreatedAt: timestamp("account_created_at", { withTimezone: true }),
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
    /** How the customer pays: "pay_on_delivery" now; "online" (Paystack) in Stage 7. */
    paymentMethod: text("payment_method").notNull().default("pay_on_delivery"),
    /**
     * Placed while signed in to the customer account. Until the account's email
     * is verified, only these orders show in "My orders": anyone can register
     * with someone else's email, and must not see that person's guest orders.
     */
    placedSignedIn: boolean("placed_signed_in").notNull().default(false),
    /** Online payment provider + reference (Stage 7). */
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
    check("orders_payment_method_check", sql`${t.paymentMethod} IN ('pay_on_delivery', 'bank_transfer', 'online')`),
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

/** A signed-in customer's session. The cookie holds a random token; only its SHA-256 is stored. */
export const customerSessions = pgTable(
  "customer_sessions",
  {
    id: id(),
    storeId: uuid("store_id").notNull(),
    customerId: uuid("customer_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ columns: [t.storeId, t.customerId], foreignColumns: [customers.storeId, customers.id] }).onDelete("cascade"),
    index("customer_sessions_customer").on(t.storeId, t.customerId),
    tenantPolicy(),
  ],
);

/** Shopping cart, identified by a random cookie token (hashed here). Prices are always read live. */
export const carts = pgTable(
  "carts",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id"), // FK in 0006 (SET NULL customer_id)
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("carts_store_id_id_key").on(t.storeId, t.id),
    check("carts_status_check", sql`${t.status} IN ('active', 'converted', 'abandoned')`),
    index("carts_customer").on(t.storeId, t.customerId),
    tenantPolicy(),
  ],
);

export const cartItems = pgTable(
  "cart_items",
  {
    id: id(),
    storeId: uuid("store_id").notNull(),
    cartId: uuid("cart_id").notNull(),
    variantId: uuid("variant_id").notNull(),
    quantity: integer("quantity").notNull(),
    addedAt: createdAt(),
  },
  (t) => [
    unique("cart_items_cart_variant_key").on(t.cartId, t.variantId),
    check("cart_items_quantity_check", sql`${t.quantity} BETWEEN 1 AND 999`),
    foreignKey({ columns: [t.storeId, t.cartId], foreignColumns: [carts.storeId, carts.id] }).onDelete("cascade"),
    tenantPolicy(),
  ],
);
