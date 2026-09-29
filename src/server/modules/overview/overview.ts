import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { orderItems, orders, products, productVariants } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { SOLD_STATUSES } from "../orders/orders";
import { inSequence } from "../../db/sql";

export const LOW_STOCK_THRESHOLD = 5;

/** Dashboard home numbers for the last `days` days. */
export async function getOverview(tx: TenantTx, storeId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const sold = inArray(orders.status, [...SOLD_STATUSES]);

  const [[totals], [awaiting], [activeProducts], topProducts, recentOrders, lowStock] = await inSequence(
    () =>
      tx
        .select({
          salesMinor: sql<number>`coalesce(sum(${orders.totalMinor}) FILTER (WHERE ${sold}), 0)::bigint`.mapWith(Number),
          soldOrders: sql<number>`count(*) FILTER (WHERE ${sold})::int`,
          allOrders: sql<number>`count(*) FILTER (WHERE ${orders.status} <> 'cancelled')::int`,
        })
        .from(orders)
        .where(and(eq(orders.storeId, storeId), gte(orders.createdAt, since))),
    () =>
      tx
        .select({
          toFulfil: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'paid')::int`,
          unpaid: sql<number>`count(*) FILTER (WHERE ${orders.status} = 'pending')::int`,
        })
        .from(orders)
        .where(eq(orders.storeId, storeId)),
    () =>
      tx
        .select({ n: count() })
        .from(products)
        .where(and(eq(products.storeId, storeId), eq(products.status, "active"), isNull(products.deletedAt))),
    () =>
      tx
        .select({
          productId: orderItems.productId,
          title: orderItems.productTitle,
          quantity: sql<number>`sum(${orderItems.quantity})::int`,
          revenueMinor: sql<number>`sum(${orderItems.lineTotalMinor})::bigint`.mapWith(Number),
        })
        .from(orderItems)
        .innerJoin(orders, and(eq(orders.storeId, orderItems.storeId), eq(orders.id, orderItems.orderId)))
        .where(and(eq(orderItems.storeId, storeId), sold, gte(orders.createdAt, since)))
        .groupBy(orderItems.productId, orderItems.productTitle)
        .orderBy(desc(sql`sum(${orderItems.quantity})`))
        .limit(5),
    () =>
      tx
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          status: orders.status,
          totalMinor: orders.totalMinor,
          currency: orders.currency,
          createdAt: orders.createdAt,
          customerName: sql<string | null>`${orders.shippingAddress}->>'fullName'`,
        })
        .from(orders)
        .where(eq(orders.storeId, storeId))
        .orderBy(desc(orders.createdAt))
        .limit(5),
    () =>
      tx
        .select({
          productId: products.id,
          productTitle: products.title,
          variantTitle: productVariants.title,
          stock: productVariants.stockQuantity,
        })
        .from(productVariants)
        .innerJoin(products, and(eq(products.storeId, productVariants.storeId), eq(products.id, productVariants.productId)))
        .where(
          and(
            eq(productVariants.storeId, storeId),
            eq(productVariants.trackInventory, true),
            lte(productVariants.stockQuantity, LOW_STOCK_THRESHOLD),
            isNull(productVariants.deletedAt),
            isNull(products.deletedAt),
            eq(products.status, "active"),
          ),
        )
        .orderBy(asc(productVariants.stockQuantity))
        .limit(5),
  );

  return {
    days,
    salesMinor: totals.salesMinor,
    orders: totals.allOrders,
    averageOrderMinor: totals.soldOrders ? Math.round(totals.salesMinor / totals.soldOrders) : 0,
    toFulfil: awaiting.toFulfil,
    unpaid: awaiting.unpaid,
    activeProducts: activeProducts.n,
    topProducts,
    recentOrders,
    lowStock,
  };
}
