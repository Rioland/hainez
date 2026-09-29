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

/**
 * Run several queries on ONE connection (a transaction) and collect the results.
 *
 * A transaction is a single pg client, so Promise.all doesn't run queries in
 * parallel anyway: pg just queues them, which is deprecated and becomes an
 * error in pg 9. Pass functions so each query starts after the previous one.
 */
export async function inSequence<const T extends readonly (() => PromiseLike<unknown>)[]>(
  ...queries: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const run of queries) results.push(await run());
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
