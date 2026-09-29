import "server-only";
import { auditLogs } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import type { StoreActor } from "../_shared/actor";

const SECRET_FIELDS = /(password|secret|token|key)/i;

/** Remove anything that looks like a secret before it lands in the audit log. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_FIELDS.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

/**
 * Append an audit entry inside the same tenant transaction as the change, so
 * the log and the data can never disagree.
 */
export async function audit(
  tx: TenantTx,
  actor: StoreActor,
  entry: { action: string; entityType?: string; entityId?: string; changes?: unknown },
) {
  await tx.insert(auditLogs).values({
    storeId: actor.storeId,
    actorType: actor.impersonatorId ? "super_admin" : "user",
    actorUserId: actor.userId,
    impersonatorUserId: actor.impersonatorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    changes: entry.changes === undefined ? null : redact(entry.changes),
    ipAddress: actor.ip,
    userAgent: actor.userAgent?.slice(0, 500) ?? null,
  });
}
