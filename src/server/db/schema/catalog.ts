import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ProductOption } from "../../../lib/variants";
import { createdAt, id, tenantPolicy, updatedAt } from "./_shared";
import { productStatus } from "./enums";
import { media } from "./media";
import { stores } from "./stores";

/*
 * Catalog. Every table carries store_id and children reference parents with
 * COMPOSITE foreign keys (store_id, parent_id), so a row can never point at
 * another store's row. Nullable composite references that must "SET NULL"
 * only their own column (categories.parent_id, product_images.variant_id, ...)
 * are declared in drizzle/0004_nullable_tenant_fks.sql, because Drizzle can't
 * express `ON DELETE SET NULL (column)`.
 */

const SLUG_CHECK = "^[a-z0-9]+(-[a-z0-9]+)*$";

export type { ProductOption };

export const categories = pgTable(
  "categories",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"), // FK in 0004 (SET NULL parent_id)
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    imageMediaId: uuid("image_media_id"), // FK in 0004
    position: integer("position").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("categories_store_id_id_key").on(t.storeId, t.id),
    unique("categories_store_slug_key").on(t.storeId, t.slug),
    check("categories_slug_check", sql.raw(`slug ~ '${SLUG_CHECK}'`)),
    check("categories_not_own_parent", sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
    tenantPolicy(),
  ],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    /** Plain text for now (rendered with line breaks); rich text later. */
    description: text("description"),
    status: productStatus("status").notNull().default("draft"),
    /** [{"name":"Size","values":["S","M"]},{"name":"Colour","values":["Red"]}] */
    options: jsonb("options").$type<ProductOption[]>().notNull().default([]),
    isFeatured: boolean("is_featured").notNull().default(false),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Soft delete: order history keeps pointing at the product. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("products_store_id_id_key").on(t.storeId, t.id),
    uniqueIndex("products_store_slug").on(t.storeId, t.slug).where(sql`deleted_at IS NULL`),
    index("products_listing").on(t.storeId, t.status, t.createdAt.desc()).where(sql`deleted_at IS NULL`),
    index("products_search").using("gin", sql`to_tsvector('simple', ${t.title} || ' ' || coalesce(${t.description}, ''))`),
    check("products_slug_check", sql.raw(`slug ~ '${SLUG_CHECK}'`)),
    check("products_title_check", sql`char_length(${t.title}) BETWEEN 1 AND 200`),
    tenantPolicy(),
  ],
);

export const productCategories = pgTable(
  "product_categories",
  {
    storeId: uuid("store_id").notNull(),
    productId: uuid("product_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.storeId, t.productId, t.categoryId] }),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.storeId, t.categoryId], foreignColumns: [categories.storeId, categories.id] }).onDelete(
      "cascade",
    ),
    index("product_categories_category").on(t.storeId, t.categoryId, t.position),
    tenantPolicy(),
  ],
);

/** Every product has at least one variant ("Default"), so price and stock live in one place. */
export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    storeId: uuid("store_id").notNull(),
    productId: uuid("product_id").notNull(),
    title: text("title").notNull().default("Default"),
    sku: text("sku"),
    /** {"Size":"M","Colour":"Red"}; {} for the default variant. */
    optionValues: jsonb("option_values").$type<Record<string, string>>().notNull().default({}),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    compareAtPriceMinor: bigint("compare_at_price_minor", { mode: "number" }),
    stockQuantity: integer("stock_quantity").notNull().default(0),
    trackInventory: boolean("track_inventory").notNull().default(true),
    allowBackorder: boolean("allow_backorder").notNull().default(false),
    weightGrams: integer("weight_grams"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    unique("product_variants_store_id_id_key").on(t.storeId, t.id),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete("cascade"),
    uniqueIndex("product_variants_sku").on(t.storeId, t.sku).where(sql`sku IS NOT NULL AND deleted_at IS NULL`),
    uniqueIndex("product_variants_options").on(t.productId, t.optionValues).where(sql`deleted_at IS NULL`),
    index("product_variants_product").on(t.storeId, t.productId, t.position),
    check("product_variants_price_check", sql`${t.priceMinor} >= 0`),
    check("product_variants_compare_at_check", sql`${t.compareAtPriceMinor} IS NULL OR ${t.compareAtPriceMinor} >= 0`),
    check(
      "product_variants_stock_check",
      sql`${t.stockQuantity} >= 0 OR ${t.allowBackorder} OR NOT ${t.trackInventory}`,
    ),
    tenantPolicy(),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    storeId: uuid("store_id").notNull(),
    productId: uuid("product_id").notNull(),
    mediaId: uuid("media_id").notNull(),
    variantId: uuid("variant_id"), // FK in 0004 (SET NULL variant_id)
    alt: text("alt"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    unique("product_images_store_id_id_key").on(t.storeId, t.id),
    foreignKey({ columns: [t.storeId, t.productId], foreignColumns: [products.storeId, products.id] }).onDelete("cascade"),
    foreignKey({ columns: [t.storeId, t.mediaId], foreignColumns: [media.storeId, media.id] }).onDelete("cascade"),
    index("product_images_product").on(t.storeId, t.productId, t.position),
    tenantPolicy(),
  ],
);
