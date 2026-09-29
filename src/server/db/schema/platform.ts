import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Subdomains nobody may claim. Seeded from src/server/tenancy/reserved.ts; the
 * table lets super admins add more without a deploy.
 */
export const reservedSubdomains = pgTable(
  "reserved_subdomains",
  {
    name: text("name").primaryKey(),
    reason: text("reason"),
  },
  (t) => [check("reserved_subdomains_name_check", sql`${t.name} ~ '^[a-z0-9-]+$'`)],
);

/**
 * Key/value platform settings editable in super-admin, e.g.
 *   billing        {"trial_days":30,"grace_days":7}
 *   domain_pricing {"markup_percent":25,"markup_fixed_minor":500000}
 *   fx_usd_ngn     {"rate":1550,"source":"manual"}
 */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
