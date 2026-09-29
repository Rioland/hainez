import { sql, type SQL } from "drizzle-orm";

/**
 * Wrap a correlated subquery used as a select field.
 *
 * Drizzle drops table names from column references that appear DIRECTLY in a
 * select-field SQL template when the query reads from a single table. Inside a
 * subquery that silently changes meaning ("order_id" = "id" binds to the inner
 * table). Nesting the subquery as its own SQL chunk keeps every column fully
 * qualified.
 */
export function subquery<T>(inner: SQL): SQL<T> {
  return sql<T>`(${inner})`;
}
