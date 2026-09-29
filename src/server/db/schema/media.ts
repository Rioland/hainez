import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantPolicy } from "./_shared";
import { users } from "./auth";
import { stores } from "./stores";

/**
 * Every uploaded file (product images now; logos/favicons/banners in Stage 4).
 * The object lives in storage under stores/<store_id>/...; this row is the
 * source of truth and is what other tables reference.
 */
export const media = pgTable(
  "media",
  {
    id: id(),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("media_store_id_id_key").on(t.storeId, t.id),
    check(
      "media_content_type_check",
      sql`${t.contentType} IN ('image/jpeg','image/png','image/webp','image/avif','image/gif')`,
    ),
    check("media_byte_size_check", sql`${t.byteSize} > 0`),
    index("media_store_idx").on(t.storeId, t.createdAt),
    tenantPolicy(),
  ],
);
