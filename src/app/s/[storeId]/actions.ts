"use server";

import { refresh } from "next/cache";
import { withTenant } from "@/server/db/tenant";
import { orderViewToken } from "@/server/security/tokens";
import { runShopAction, type ShopActionState } from "@/server/modules/storefront/action";
import { addItem, CART_COOKIE, ensureCart, findActiveCart, markCartConverted, setItemQuantity } from "@/server/modules/storefront/cart";
import { placeOrder } from "@/server/modules/storefront/checkout";
import { DomainError } from "@/server/modules/_shared/errors";
import { readCookie } from "@/server/modules/storefront/context";
import { endCustomerSession, getCurrentCustomer, startCustomerSession } from "@/server/modules/storefront/customer-auth";

/*
 * Storefront server actions. None of them takes a store id from the browser:
 * runShopAction reads it from the header the proxy set for this host.
 */

const MINUTE = 60_000;

/** Final state for the client: success (with an optional message/redirect) or the error. */
function finish<T>(result: ShopActionState<T>, success: { message?: string; redirectTo?: string } = {}): ShopActionState {
  return result?.ok ? { ok: true, ...success } : result;
}

export async function addToCartAction(_prev: ShopActionState, formData: FormData): Promise<ShopActionState> {
  const result = await runShopAction({ limit: { key: "cart", max: 60, windowMs: MINUTE } }, async ({ storeId }) => {
    const customer = await getCurrentCustomer(storeId);
    await withTenant(storeId, async (tx) => {
      const cartId = await ensureCart(tx, storeId, customer?.id ?? null);
      await addItem(tx, storeId, cartId, {
        variantId: String(formData.get("variantId") ?? ""),
        quantity: Number(formData.get("quantity") ?? 1),
      });
    });
  });
  if (result?.ok) refresh(); // header cart count
  return finish(result, { message: "Added to your cart." });
}

export async function updateCartItemAction(itemId: string, quantity: number): Promise<ShopActionState> {
  const result = await runShopAction({ limit: { key: "cart", max: 60, windowMs: MINUTE } }, async ({ storeId }) => {
    const token = await readCookie(CART_COOKIE);
    await withTenant(storeId, async (tx) => {
      // The cart comes from this browser's cookie, so an item id from another cart does nothing.
      const cart = await findActiveCart(tx, storeId, token);
      if (!cart) return;
      await setItemQuantity(tx, storeId, cart.id, itemId, quantity);
    });
  });
  if (result?.ok) refresh();
  return finish(result);
}

export async function placeOrderAction(_prev: ShopActionState, formData: FormData): Promise<ShopActionState> {
  const result = await runShopAction({ limit: { key: "checkout", max: 10, windowMs: 10 * MINUTE } }, async ({ storeId, base }) => {
    const customer = await getCurrentCustomer(storeId);
    const token = await readCookie(CART_COOKIE);
    const field = (k: string) => String(formData.get(k) ?? "");
    const order = await withTenant(storeId, async (tx) => {
      const cart = await findActiveCart(tx, storeId, token);
      if (!cart) throw new DomainError("Your cart is empty.");
      const placed = await placeOrder(
        tx,
        storeId,
        cart.id,
        {
          email: field("email"),
          fullName: field("fullName"),
          phone: field("phone"),
          line1: field("line1"),
          line2: field("line2"),
          city: field("city"),
          state: field("state"),
          deliveryId: field("deliveryId"),
          note: field("note"),
          paymentMethod: "pay_on_delivery",
        },
        customer,
      );
      await markCartConverted(tx, storeId, cart.id);
      return placed;
    });
    // The confirmation link doubles as the guest's way back to this order.
    return `${base}/order/${order.id}?t=${orderViewToken(order.id)}`;
  });
  // No refresh(): the client does a full page load of the confirmation page.
  return finish(result, { redirectTo: result?.ok ? result.data : undefined });
}

export async function customerAuthAction(mode: "login" | "register", _prev: ShopActionState, formData: FormData): Promise<ShopActionState> {
  const result = await runShopAction(
    { limit: { key: `customer-${mode}`, max: mode === "login" ? 10 : 5, windowMs: 15 * MINUTE } },
    async ({ storeId, base }) => {
      await startCustomerSession(storeId, mode, {
        name: String(formData.get("name") ?? ""),
        email: String(formData.get("email") ?? ""),
        password: String(formData.get("password") ?? ""),
        phone: String(formData.get("phone") ?? ""),
      });
      const next = String(formData.get("next") ?? "");
      // Only same-store relative paths.
      return next.startsWith(`${base}/`) && !next.startsWith("//") ? next : `${base}/account`;
    },
  );
  return finish(result, { redirectTo: result?.ok ? result.data : undefined });
}

export async function logoutAction(): Promise<ShopActionState> {
  const result = await runShopAction({}, async ({ storeId, base }) => {
    await endCustomerSession(storeId);
    return base || "/";
  });
  return finish(result, { redirectTo: result?.ok ? result.data : undefined });
}
