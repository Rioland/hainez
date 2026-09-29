import { index, inet, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tenantPolicy } from "./_shared";
import { users } from "./auth";
import { actorType } from "./enums";
import { stores } from "./stores";

/**
 * Append-only audit trail (a trigger in 0004 rejects UPDATE/DELETE for every
 * role). store_id NULL = platform-level action, visible only to super admins.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    impersonatorUserId: uuid("impersonator_user_id").references(() => users.id, { onDelete: "set null" }),
    /** e.g. "product.update", "order.status_change", "store.settings_update" */
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    /** {"field":[old,new]} with secrets redacted. */
    changes: jsonb("changes"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_store").on(t.storeId, t.createdAt.desc()),
    index("audit_logs_actor").on(t.actorUserId, t.createdAt.desc()),
    tenantPolicy(),
  ],
);
