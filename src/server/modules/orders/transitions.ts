/**
 * Order status rules (pure, shared by server and UI).
 *
 *   pending ──► paid ──► shipped ──► delivered
 *      │          │
 *      │          └──► cancelled
 *      ├──► shipped            (pay on delivery)
 *      └──► cancelled
 *
 * Stock is taken when an order first becomes paid or shipped, and put back if
 * it is cancelled after that. Delivering an unpaid (pay-on-delivery) order
 * marks it paid.
 */

export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled";

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "shipped", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Does moving into `to` require stock to be committed (if it isn't already)? */
export const commitsInventory = (to: OrderStatus) => to === "paid" || to === "shipped";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const ORDER_ACTION_LABEL: Record<OrderStatus, string> = {
  pending: "Mark pending",
  paid: "Mark as paid",
  shipped: "Mark as shipped",
  delivered: "Mark as delivered",
  cancelled: "Cancel order",
};
