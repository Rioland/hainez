import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  customers,
  media,
  orderItems,
  orders,
  orderStatusHistory,
  productImages,
  products,
  productVariants,
  shippingMethods,
  stores,
  type Address,
} from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { audit } from "../audit/audit";
import { subquery } from "../../db/sql";
import { mediaUrl } from "../media/uploads";
import type { StoreActor } from "../_shared/actor";
import { DomainError, NotFoundError } from "../_shared/errors";
import { pageParams, toPage } from "../_shared/pagination";
import { canTransition, commitsInventory, type OrderStatus } from "./transitions";

export const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"] as const;
/** Statuses that count as a sale in reports. */
export const SOLD_STATUSES = ["paid", "shipped", "delivered"] as const;

/* ----------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------- */

export type OrderFilters = { status?: string; q?: string; from?: string; to?: string; page?: unknown };

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const isDate = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));

export async function listOrders(tx: TenantTx, storeId: string, f: OrderFilters) {
  const { page, limit, offset } = pageParams(f.page);
  const where: SQL[] = [eq(orders.storeId, storeId)];
  if (f.status && (ORDER_STATUSES as readonly string[]).includes(f.status)) where.push(eq(orders.status, f.status as OrderStatus));
  if (isDate(f.from)) where.push(gte(orders.createdAt, new Date(`${f.from}T00:00:00Z`)));
  if (isDate(f.to)) where.push(lte(orders.createdAt, new Date(`${f.to}T23:59:59Z`)));
  const q = f.q?.trim().replace(/^#/, "");
  if (q) {
    const pattern = `%${likeEscape(q)}%`;
    const conds: SQL[] = [ilike(orders.email, pattern), sql`${orders.shippingAddress}->>'fullName' ILIKE ${pattern}`];
    if (/^\d{1,9}$/.test(q)) conds.push(eq(orders.orderNumber, Number(q)));
    where.push(or(...conds)!);
  }

  const rows = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      createdAt: orders.createdAt,
      email: orders.email,
      customerName: sql<string | null>`${orders.shippingAddress}->>'fullName'`,
      status: orders.status,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      itemCount: subquery<number>(
        sql`SELECT coalesce(sum(${orderItems.quantity}), 0)::int FROM ${orderItems} WHERE ${orderItems.orderId} = ${orders.id}`,
      ),
      total: sql<number>`count(*) OVER ()`.mapWith(Number),
    })
    .from(orders)
    .where(and(...where))
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(offset);
  return toPage(
    rows.map(({ total: _t, ...r }) => r),
    rows[0]?.total ?? 0,
    page,
  );
}

export async function getOrder(tx: TenantTx, storeId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [order] = await tx.select().from(orders).where(and(eq(orders.storeId, storeId), eq(orders.id, id)));
  if (!order) return null;
  const [items, history, customer] = await Promise.all([
    tx.select().from(orderItems).where(and(eq(orderItems.storeId, storeId), eq(orderItems.orderId, id))).orderBy(asc(orderItems.productTitle)),
    tx
      .select()
      .from(orderStatusHistory)
      .where(and(eq(orderStatusHistory.storeId, storeId), eq(orderStatusHistory.orderId, id)))
      .orderBy(asc(orderStatusHistory.createdAt)),
    order.customerId
      ? tx
          .select({ id: customers.id, name: customers.name, email: customers.email, phone: customers.phone })
          .from(customers)
          .where(and(eq(customers.storeId, storeId), eq(customers.id, order.customerId)))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  return { ...order, items, history, customer };
}

/* ----------------------------------------------------------------------------
 * Inventory
 * ------------------------------------------------------------------------- */

async function lockVariantsForOrder(tx: TenantTx, storeId: string, orderId: string) {
  const items = await tx
    .select({ variantId: orderItems.variantId, quantity: orderItems.quantity, title: orderItems.productTitle, variantTitle: orderItems.variantTitle })
    .from(orderItems)
    .where(and(eq(orderItems.storeId, storeId), eq(orderItems.orderId, orderId)));
  const ids = [...new Set(items.map((i) => i.variantId).filter(Boolean) as string[])];
  const variants = ids.length
    ? await tx
        .select({
          id: productVariants.id,
          stock: productVariants.stockQuantity,
          track: productVariants.trackInventory,
          backorder: productVariants.allowBackorder,
        })
        .from(productVariants)
        .where(and(eq(productVariants.storeId, storeId), inArray(productVariants.id, ids)))
        .for("update")
    : [];
  return { items, variants: new Map(variants.map((v) => [v.id, v])) };
}

/** Take stock for every item in the order. All-or-nothing (runs in the caller's transaction). */
export async function commitInventory(tx: TenantTx, storeId: string, orderId: string) {
  const { items, variants } = await lockVariantsForOrder(tx, storeId, orderId);
  // Sum per variant in case the same variant appears twice.
  const need = new Map<string, { qty: number; label: string }>();
  for (const i of items) {
    if (!i.variantId) continue;
    const prev = need.get(i.variantId);
    need.set(i.variantId, { qty: (prev?.qty ?? 0) + i.quantity, label: i.variantTitle ? `${i.title} (${i.variantTitle})` : i.title });
  }
  for (const [variantId, { qty, label }] of need) {
    const v = variants.get(variantId);
    if (!v || !v.track) continue;
    if (!v.backorder && v.stock < qty) {
      throw new DomainError(`Not enough stock for ${label}: ${v.stock} left, order needs ${qty}.`);
    }
    await tx
      .update(productVariants)
      .set({ stockQuantity: sql`${productVariants.stockQuantity} - ${qty}` })
      .where(and(eq(productVariants.storeId, storeId), eq(productVariants.id, variantId)));
  }
}

/** Put stock back (order cancelled after stock was taken). */
export async function restoreInventory(tx: TenantTx, storeId: string, orderId: string) {
  const { items, variants } = await lockVariantsForOrder(tx, storeId, orderId);
  for (const i of items) {
    if (!i.variantId || !variants.get(i.variantId)?.track) continue;
    await tx
      .update(productVariants)
      .set({ stockQuantity: sql`${productVariants.stockQuantity} + ${i.quantity}` })
      .where(and(eq(productVariants.storeId, storeId), eq(productVariants.id, i.variantId)));
  }
}

/* ----------------------------------------------------------------------------
 * Status changes
 * ------------------------------------------------------------------------- */

export const statusChangeInput = z.object({
  to: z.enum(ORDER_STATUSES),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => v || null),
  trackingNumber: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || null),
});

export async function changeOrderStatus(tx: TenantTx, actor: StoreActor, orderId: string, raw: z.input<typeof statusChangeInput>) {
  const input = statusChangeInput.parse(raw);
  // Lock the row: two staff clicking "ship" at once must not both succeed.
  const [order] = await tx
    .select({ id: orders.id, status: orders.status, inventoryCommitted: orders.inventoryCommitted, paidAt: orders.paidAt, orderNumber: orders.orderNumber })
    .from(orders)
    .where(and(eq(orders.storeId, actor.storeId), eq(orders.id, orderId)))
    .for("update");
  if (!order) throw new NotFoundError("Order");
  if (!canTransition(order.status, input.to)) {
    throw new DomainError(`An order that is ${order.status} can't be marked ${input.to}.`);
  }

  const now = new Date();
  const patch: Partial<typeof orders.$inferInsert> = { status: input.to };
  let inventoryCommitted = order.inventoryCommitted;

  if (commitsInventory(input.to) && !inventoryCommitted) {
    await commitInventory(tx, actor.storeId, order.id);
    inventoryCommitted = true;
  }
  if (input.to === "cancelled" && inventoryCommitted) {
    await restoreInventory(tx, actor.storeId, order.id);
    inventoryCommitted = false;
  }
  patch.inventoryCommitted = inventoryCommitted;

  if (input.to === "paid") patch.paidAt = now;
  if (input.to === "shipped") {
    patch.shippedAt = now;
    if (input.trackingNumber) patch.trackingNumber = input.trackingNumber;
  }
  if (input.to === "delivered") {
    patch.deliveredAt = now;
    if (!order.paidAt) patch.paidAt = now; // pay on delivery: collected at the door
  }
  if (input.to === "cancelled") {
    patch.cancelledAt = now;
    patch.cancelReason = input.note;
  }

  await tx.update(orders).set(patch).where(and(eq(orders.storeId, actor.storeId), eq(orders.id, order.id)));
  await tx.insert(orderStatusHistory).values({
    storeId: actor.storeId,
    orderId: order.id,
    fromStatus: order.status,
    toStatus: input.to,
    note: input.note ?? (input.trackingNumber ? `Tracking: ${input.trackingNumber}` : null),
    actorType: actor.impersonatorId ? "super_admin" : "user",
    actorId: actor.userId,
  });
  await audit(tx, actor, {
    action: "order.status_change",
    entityType: "order",
    entityId: order.id,
    changes: { status: [order.status, input.to], orderNumber: order.orderNumber },
  });
}

export async function updateInternalNote(tx: TenantTx, actor: StoreActor, orderId: string, note: string) {
  const clean = note.trim().slice(0, 2000) || null;
  const [row] = await tx
    .update(orders)
    .set({ internalNote: clean })
    .where(and(eq(orders.storeId, actor.storeId), eq(orders.id, orderId)))
    .returning({ id: orders.id });
  if (!row) throw new NotFoundError("Order");
  await audit(tx, actor, { action: "order.note", entityType: "order", entityId: orderId });
}

/* ----------------------------------------------------------------------------
 * Creating orders (used by seed/tests now, by checkout in Stage 3)
 * ------------------------------------------------------------------------- */

const addressInput = z.object({
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(30),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().length(2).default("NG"),
});

export const createOrderInput = z.object({
  email: z.email(),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  items: z
    .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(999) }))
    .min(1)
    .max(100),
  shippingMethodId: z.uuid().nullable().optional(),
  shippingAddress: addressInput,
  customerNote: z.string().trim().max(1000).optional(),
});

/**
 * Price an order from the database (never from the client), assign the next
 * order number, and record it as pending. Stock is taken when it's paid.
 */
export async function createOrder(tx: TenantTx, storeId: string, raw: z.input<typeof createOrderInput>) {
  const input = createOrderInput.parse(raw);

  const variantIds = [...new Set(input.items.map((i) => i.variantId))];
  const found = await tx
    .select({
      id: productVariants.id,
      productId: productVariants.productId,
      price: productVariants.priceMinor,
      sku: productVariants.sku,
      variantTitle: productVariants.title,
      productTitle: products.title,
      imageKey: subquery<string | null>(sql`
        SELECT ${media.storageKey} FROM ${productImages} JOIN ${media} ON ${media.id} = ${productImages.mediaId}
        WHERE ${productImages.productId} = ${products.id} ORDER BY ${productImages.position} LIMIT 1`),
    })
    .from(productVariants)
    .innerJoin(products, and(eq(products.storeId, productVariants.storeId), eq(products.id, productVariants.productId)))
    .where(
      and(
        eq(productVariants.storeId, storeId),
        inArray(productVariants.id, variantIds),
        isNull(productVariants.deletedAt),
        isNull(products.deletedAt),
      ),
    );
  const byId = new Map(found.map((v) => [v.id, v]));
  const missing = variantIds.filter((id) => !byId.has(id));
  if (missing.length) throw new DomainError("Some items are no longer available.");

  const lines = input.items.map((i) => {
    const v = byId.get(i.variantId)!;
    return {
      productId: v.productId,
      variantId: v.id,
      productTitle: v.productTitle,
      variantTitle: v.variantTitle === "Default" ? null : v.variantTitle,
      sku: v.sku,
      imageUrl: v.imageKey ? mediaUrl(v.imageKey) : null,
      unitPriceMinor: v.price,
      quantity: i.quantity,
      lineTotalMinor: v.price * i.quantity,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotalMinor, 0);

  let shippingMinor = 0;
  let shippingName: string | null = null;
  if (input.shippingMethodId) {
    const [m] = await tx
      .select()
      .from(shippingMethods)
      .where(and(eq(shippingMethods.storeId, storeId), eq(shippingMethods.id, input.shippingMethodId), eq(shippingMethods.isActive, true)));
    if (!m) throw new DomainError("That delivery option is no longer available.");
    shippingMinor = m.freeOverMinor !== null && subtotal >= m.freeOverMinor ? 0 : m.priceMinor;
    shippingName = m.name;
  }

  const [store] = await tx
    .update(stores)
    .set({ nextOrderNumber: sql`${stores.nextOrderNumber} + 1` })
    .where(eq(stores.id, storeId))
    .returning({ orderNumber: sql<number>`${stores.nextOrderNumber} - 1`, currency: stores.currency });
  if (!store) throw new NotFoundError("Store");

  // Guest customer record per email (accounts arrive in Stage 3).
  const [customer] = await tx
    .insert(customers)
    .values({ storeId, email: input.email.toLowerCase(), name: input.name ?? input.shippingAddress.fullName, phone: input.phone ?? input.shippingAddress.phone })
    .onConflictDoUpdate({
      target: [customers.storeId, customers.email],
      set: { name: sql`coalesce(${customers.name}, excluded.name)`, phone: sql`coalesce(${customers.phone}, excluded.phone)` },
    })
    .returning({ id: customers.id });

  const [order] = await tx
    .insert(orders)
    .values({
      storeId,
      orderNumber: store.orderNumber,
      customerId: customer.id,
      email: input.email.toLowerCase(),
      phone: input.phone ?? input.shippingAddress.phone,
      currency: store.currency,
      subtotalMinor: subtotal,
      shippingMinor,
      totalMinor: subtotal + shippingMinor,
      shippingMethodId: input.shippingMethodId ?? null,
      shippingMethodName: shippingName,
      shippingAddress: input.shippingAddress as Address,
      customerNote: input.customerNote ?? null,
    })
    .returning({ id: orders.id, orderNumber: orders.orderNumber, totalMinor: orders.totalMinor });

  await tx.insert(orderItems).values(lines.map((l) => ({ ...l, storeId, orderId: order.id })));
  await tx.insert(orderStatusHistory).values({ storeId, orderId: order.id, fromStatus: null, toStatus: "pending", actorType: "customer" });
  return order;
}
