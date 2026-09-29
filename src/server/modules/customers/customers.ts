import "server-only";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { customers, orders } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { subquery } from "../../db/sql";
import { SOLD_STATUSES } from "../orders/orders";
import { pageParams, toPage } from "../_shared/pagination";

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Order stats per customer, computed from the orders table (no denormalised counters to drift). */
const stats = {
  orderCount: subquery<number>(
    sql`SELECT count(*)::int FROM ${orders} WHERE ${orders.customerId} = ${customers.id} AND ${orders.status} <> 'cancelled'`,
  ),
  totalSpentMinor: subquery<number>(sql`
    SELECT coalesce(sum(${orders.totalMinor}), 0)::bigint FROM ${orders}
    WHERE ${orders.customerId} = ${customers.id} AND ${inArray(orders.status, [...SOLD_STATUSES])}`).mapWith(Number),
  lastOrderAt: subquery<Date | null>(sql`SELECT max(${orders.createdAt}) FROM ${orders} WHERE ${orders.customerId} = ${customers.id}`).mapWith(
    (v) => (v ? new Date(v) : null),
  ),
};

export async function listCustomers(tx: TenantTx, storeId: string, f: { q?: string; page?: unknown }) {
  const { page, limit, offset } = pageParams(f.page);
  const where: SQL[] = [eq(customers.storeId, storeId)];
  const q = f.q?.trim();
  if (q) {
    const p = `%${likeEscape(q)}%`;
    where.push(or(ilike(customers.email, p), ilike(customers.name, p), ilike(customers.phone, p))!);
  }
  const rows = await tx
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      hasAccount: sql<boolean>`${customers.passwordHash} IS NOT NULL`,
      createdAt: customers.createdAt,
      ...stats,
      total: sql<number>`count(*) OVER ()`.mapWith(Number),
    })
    .from(customers)
    .where(and(...where))
    .orderBy(desc(customers.createdAt))
    .limit(limit)
    .offset(offset);
  return toPage(
    rows.map(({ total: _t, ...r }) => r),
    rows[0]?.total ?? 0,
    page,
  );
}

export async function getCustomer(tx: TenantTx, storeId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [customer] = await tx
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
      acceptsMarketing: customers.acceptsMarketing,
      hasAccount: sql<boolean>`${customers.passwordHash} IS NOT NULL`,
      createdAt: customers.createdAt,
      ...stats,
    })
    .from(customers)
    .where(and(eq(customers.storeId, storeId), eq(customers.id, id)));
  if (!customer) return null;
  const customerOrders = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(and(eq(orders.storeId, storeId), eq(orders.customerId, id)))
    .orderBy(desc(orders.createdAt))
    .limit(50);
  return { ...customer, orders: customerOrders };
}
