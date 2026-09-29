import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { deliveryPrice, methodCoversState } from "@/lib/availability";
import { orderItems, orders, shippingMethods } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { commitInventory, createOrder } from "../orders/orders";
import { NG_STATES } from "../settings/settings";
import { DomainError } from "../_shared/errors";
import { loadCartLines } from "./cart";
import type { CurrentCustomer } from "./customer-auth";

/*
 * Checkout: turn the shopper's cart into a pending order.
 *   - prices, delivery cost and totals are computed on the server from the DB
 *   - every line must be available in the requested quantity right now
 *   - the delivery option must be active and cover the chosen state
 *   - stock is reserved as the order is placed (pay on delivery)
 * Payment: "pay on delivery" in Stage 3; online payment (the store's own
 * Paystack account) plugs in here in Stage 7.
 */

export type DeliveryOption = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  freeOverMinor: number | null;
  regions: string[];
  minDays: number | null;
  maxDays: number | null;
};

export async function listDeliveryOptions(tx: TenantTx, storeId: string): Promise<DeliveryOption[]> {
  return tx
    .select({
      id: shippingMethods.id,
      name: shippingMethods.name,
      description: shippingMethods.description,
      priceMinor: shippingMethods.priceMinor,
      freeOverMinor: shippingMethods.freeOverMinor,
      regions: shippingMethods.regions,
      minDays: shippingMethods.minDays,
      maxDays: shippingMethods.maxDays,
    })
    .from(shippingMethods)
    .where(and(eq(shippingMethods.storeId, storeId), eq(shippingMethods.isActive, true)))
    .orderBy(asc(shippingMethods.position), asc(shippingMethods.priceMinor));
}

const text = (min: number, max: number, msg: string) => z.string().trim().min(min, msg).max(max);

export const checkoutInput = z.object({
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  fullName: text(2, 120, "Enter your full name"),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number"),
  line1: text(3, 200, "Enter your street address"),
  line2: z.string().trim().max(200).optional(),
  city: text(2, 100, "Enter your city or town"),
  state: z.string().refine((s) => s in NG_STATES, "Choose your state"),
  deliveryId: z.uuid("Choose a delivery option"),
  note: z.string().trim().max(1000).optional(),
  paymentMethod: z.literal("pay_on_delivery"),
});
export type CheckoutInput = z.input<typeof checkoutInput>;

export async function placeOrder(
  tx: TenantTx,
  storeId: string,
  cartId: string | null,
  raw: CheckoutInput,
  customer: CurrentCustomer | null,
) {
  const input = checkoutInput.parse(raw);
  if (!cartId) throw new DomainError("Your cart is empty.");

  const lines = await loadCartLines(tx, storeId, cartId);
  if (lines.length === 0) throw new DomainError("Your cart is empty.");
  const problems = lines.filter((l) => l.issue !== null);
  if (problems.length) {
    const names = problems.map((l) => l.productTitle + (l.variantTitle ? ` (${l.variantTitle})` : "")).join(", ");
    throw new DomainError(`Some items changed since you added them: ${names}. Please review your cart.`);
  }

  const [method] = await tx
    .select()
    .from(shippingMethods)
    .where(and(eq(shippingMethods.storeId, storeId), eq(shippingMethods.id, input.deliveryId), eq(shippingMethods.isActive, true)));
  if (!method || !methodCoversState(method.regions, input.state)) {
    throw new DomainError("That delivery option isn't available for your state.", { deliveryId: ["Choose another option"] });
  }

  const order = await createOrder(tx, storeId, {
    // Signed-in customers always order under their account email.
    email: customer?.email ?? input.email,
    name: input.fullName,
    phone: input.phone,
    items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
    shippingMethodId: method.id,
    shippingAddress: {
      fullName: input.fullName,
      phone: input.phone,
      line1: input.line1,
      line2: input.line2 || undefined,
      city: input.city,
      state: NG_STATES[input.state],
      country: "NG",
    },
    customerNote: input.note || undefined,
  });
  // Pay on delivery has no payment step to wait for, so the stock is reserved
  // now (variant rows locked): two shoppers can't both buy the last one. A
  // cancelled order puts it back (changeOrderStatus).
  try {
    await commitInventory(tx, storeId, order.id);
  } catch (err) {
    if (err instanceof DomainError) throw new DomainError(`Sorry, stock just changed. ${err.message} Please update your cart.`);
    throw err;
  }
  await tx
    .update(orders)
    .set({ paymentMethod: input.paymentMethod, placedSignedIn: customer !== null, inventoryCommitted: true })
    .where(and(eq(orders.storeId, storeId), eq(orders.id, order.id)));
  return order;
}

/** Totals preview for the checkout page (the server recomputes on submit). */
export function previewTotals(subtotal: number, method: Pick<DeliveryOption, "priceMinor" | "freeOverMinor"> | null) {
  const delivery = method ? deliveryPrice(method, subtotal) : 0;
  return { subtotal, delivery, total: subtotal + delivery };
}

/* ------------------------------------------------------ viewing orders */

/**
 * Orders a signed-in customer may see: the ones placed while signed in to this
 * account, plus their earlier guest orders once the email is verified (Stage 10).
 * Registration doesn't prove the email yet, so an account opened with someone
 * else's address must not reveal that person's guest orders (addresses, phone).
 */
function visibleToCustomer(customer: CurrentCustomer) {
  return and(eq(orders.customerId, customer.id), customer.emailVerifiedAt ? undefined : eq(orders.placedSignedIn, true));
}

export async function listCustomerOrders(tx: TenantTx, storeId: string, customer: CurrentCustomer) {
  return tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      status: orders.status,
      totalMinor: orders.totalMinor,
      currency: orders.currency,
      createdAt: orders.createdAt,
      itemCount: sql<number>`(SELECT coalesce(sum(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = orders.id)`,
    })
    .from(orders)
    .where(and(eq(orders.storeId, storeId), visibleToCustomer(customer)))
    .orderBy(desc(orders.createdAt))
    .limit(100);
}

/** An order for the storefront: by its secret link token, or because it's the signed-in customer's. */
export async function getOrderForShopper(
  tx: TenantTx,
  storeId: string,
  orderId: string,
  access: { tokenValid: boolean; customer: CurrentCustomer | null },
) {
  if (!z.uuid().safeParse(orderId).success) return null;
  const ownership = access.customer ? visibleToCustomer(access.customer) : undefined;
  if (!access.tokenValid && !ownership) return null;
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, storeId), eq(orders.id, orderId), access.tokenValid ? undefined : ownership));
  if (!order) return null;
  const items = await tx
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.storeId, storeId), eq(orderItems.orderId, orderId)))
    .orderBy(asc(orderItems.productTitle));
  return { ...order, items };
}
