import "server-only";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { z } from "zod";
import { availability, MAX_LINE_QTY } from "@/lib/availability";
import { cartItems, carts, media, productImages, products, productVariants, stores } from "../../db/schema";
import { subquery } from "../../db/sql";
import { withTenant, type TenantTx } from "../../db/tenant";
import { hashToken, randomToken } from "../../security/tokens";
import { mediaUrl } from "../media/uploads";
import { DomainError } from "../_shared/errors";
import { readCookie, storeCookieOptions } from "./context";

/*
 * Cart. The browser holds a random token in a store-scoped cookie; the DB holds
 * its hash. Cart items store only variant + quantity: prices, availability and
 * stock are always read live, so a cart can never check out at a stale price.
 */

export const CART_COOKIE = "ms_cart";
const CART_TTL_DAYS = 30;

export type CartLine = {
  itemId: string;
  variantId: string;
  productTitle: string;
  productSlug: string;
  variantTitle: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  maxQty: number;
  /** Why this line can't be bought as-is. */
  issue: null | "unavailable" | "insufficient_stock";
};

export type CartView = {
  id: string | null;
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  currency: string;
  hasIssues: boolean;
};

/* ------------------------------------------------------------ DB level */

export async function findActiveCart(tx: TenantTx, storeId: string, token: string | undefined) {
  if (!token) return null;
  const [cart] = await tx
    .select({ id: carts.id, customerId: carts.customerId })
    .from(carts)
    .where(and(eq(carts.storeId, storeId), eq(carts.tokenHash, hashToken(token)), eq(carts.status, "active"), gt(carts.expiresAt, sql`now()`)));
  return cart ?? null;
}

export async function createCart(tx: TenantTx, storeId: string, customerId: string | null = null) {
  const token = randomToken();
  const [cart] = await tx
    .insert(carts)
    .values({
      storeId,
      customerId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + CART_TTL_DAYS * 86_400_000),
    })
    .returning({ id: carts.id });
  return { id: cart.id, token };
}

export async function loadCartLines(tx: TenantTx, storeId: string, cartId: string): Promise<CartLine[]> {
  const rows = await tx
    .select({
      itemId: cartItems.id,
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      productTitle: products.title,
      productSlug: products.slug,
      productStatus: products.status,
      productDeletedAt: products.deletedAt,
      variantTitle: productVariants.title,
      variantDeletedAt: productVariants.deletedAt,
      price: productVariants.priceMinor,
      trackInventory: productVariants.trackInventory,
      allowBackorder: productVariants.allowBackorder,
      stockQuantity: productVariants.stockQuantity,
      imageKey: subquery<string | null>(sql`
        SELECT ${media.storageKey} FROM ${productImages} JOIN ${media} ON ${media.id} = ${productImages.mediaId}
        WHERE ${productImages.productId} = ${products.id} ORDER BY ${productImages.position} LIMIT 1`),
    })
    .from(cartItems)
    .innerJoin(productVariants, and(eq(productVariants.storeId, cartItems.storeId), eq(productVariants.id, cartItems.variantId)))
    .innerJoin(products, and(eq(products.storeId, productVariants.storeId), eq(products.id, productVariants.productId)))
    .where(and(eq(cartItems.storeId, storeId), eq(cartItems.cartId, cartId)))
    .orderBy(asc(cartItems.addedAt));

  return rows.map((r) => {
    const gone = r.productStatus !== "active" || r.productDeletedAt !== null || r.variantDeletedAt !== null;
    const a = availability(r);
    const issue = gone || !a.available ? "unavailable" : r.quantity > a.maxQty ? "insufficient_stock" : null;
    return {
      itemId: r.itemId,
      variantId: r.variantId,
      productTitle: r.productTitle,
      productSlug: r.productSlug,
      variantTitle: r.variantTitle === "Default" ? null : r.variantTitle,
      imageUrl: r.imageKey ? mediaUrl(r.imageKey) : null,
      unitPrice: r.price,
      quantity: r.quantity,
      lineTotal: r.price * r.quantity,
      maxQty: gone ? 0 : a.maxQty,
      issue,
    } satisfies CartLine;
  });
}

export function summarize(lines: CartLine[], currency: string, id: string | null): CartView {
  const buyable = lines.filter((l) => l.issue !== "unavailable");
  return {
    id,
    lines,
    itemCount: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: buyable.reduce((s, l) => s + l.lineTotal, 0),
    currency,
    hasIssues: lines.some((l) => l.issue !== null),
  };
}

const addInput = z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(MAX_LINE_QTY) });

/** Add to a cart, capping at available stock. Only live variants of active products can be added. */
export async function addItem(tx: TenantTx, storeId: string, cartId: string, raw: z.input<typeof addInput>) {
  const { variantId, quantity } = addInput.parse(raw);
  const [v] = await tx
    .select({
      trackInventory: productVariants.trackInventory,
      allowBackorder: productVariants.allowBackorder,
      stockQuantity: productVariants.stockQuantity,
      title: products.title,
    })
    .from(productVariants)
    .innerJoin(products, and(eq(products.storeId, productVariants.storeId), eq(products.id, productVariants.productId)))
    .where(
      and(
        eq(productVariants.storeId, storeId),
        eq(productVariants.id, variantId),
        sql`${productVariants.deletedAt} IS NULL`,
        eq(products.status, "active"),
        sql`${products.deletedAt} IS NULL`,
      ),
    );
  if (!v) throw new DomainError("This item is no longer available.");
  const a = availability(v);
  if (!a.available) throw new DomainError("Sorry, this item is out of stock.");

  const [existing] = await tx
    .select({ id: cartItems.id, quantity: cartItems.quantity })
    .from(cartItems)
    .where(and(eq(cartItems.storeId, storeId), eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)));
  const wanted = (existing?.quantity ?? 0) + quantity;
  if (wanted > a.maxQty) {
    throw new DomainError(a.maxQty === MAX_LINE_QTY ? "That's more than we can take in one order." : `Only ${a.maxQty} left in stock.`);
  }
  if (existing) {
    await tx.update(cartItems).set({ quantity: wanted }).where(eq(cartItems.id, existing.id));
  } else {
    await tx.insert(cartItems).values({ storeId, cartId, variantId, quantity });
  }
  await tx.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

export async function setItemQuantity(tx: TenantTx, storeId: string, cartId: string, itemId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_LINE_QTY) throw new DomainError("Invalid quantity.");
  if (!z.uuid().safeParse(itemId).success) throw new DomainError("That item isn't in your cart any more.");
  const where = and(eq(cartItems.storeId, storeId), eq(cartItems.cartId, cartId), eq(cartItems.id, itemId));
  if (quantity === 0) {
    await tx.delete(cartItems).where(where);
    return;
  }
  const line = (await loadCartLines(tx, storeId, cartId)).find((l) => l.itemId === itemId);
  if (!line) throw new DomainError("That item isn't in your cart any more.");
  if (quantity > line.maxQty) throw new DomainError(line.maxQty === 0 ? "This item is no longer available." : `Only ${line.maxQty} left in stock.`);
  await tx.update(cartItems).set({ quantity }).where(where);
}

/* ------------------------------------------------------ request (cookie) level */

async function storeCurrency(tx: TenantTx, storeId: string) {
  const [s] = await tx.select({ currency: stores.currency }).from(stores).where(eq(stores.id, storeId));
  return s?.currency ?? "NGN";
}

/** The shopper's current cart (read-only; safe in server components). */
export async function getCurrentCart(storeId: string): Promise<CartView> {
  const token = await readCookie(CART_COOKIE);
  return withTenant(storeId, async (tx) => {
    const currency = await storeCurrency(tx, storeId);
    const cart = await findActiveCart(tx, storeId, token);
    if (!cart) return summarize([], currency, null);
    return summarize(await loadCartLines(tx, storeId, cart.id), currency, cart.id);
  });
}

/** Server actions only: get the cart, creating it (and its cookie) if needed. */
export async function ensureCart(tx: TenantTx, storeId: string, customerId: string | null) {
  const existing = await findActiveCart(tx, storeId, await readCookie(CART_COOKIE));
  if (existing) {
    if (customerId && !existing.customerId) await tx.update(carts).set({ customerId }).where(eq(carts.id, existing.id));
    return existing.id;
  }
  const created = await createCart(tx, storeId, customerId);
  (await cookies()).set(CART_COOKIE, created.token, await storeCookieOptions(CART_TTL_DAYS * 86_400));
  return created.id;
}

/**
 * After checkout: the cart is done. Its cookie is left alone on purpose: it now
 * points at a converted cart, which reads as empty, and the next "add to cart"
 * replaces it. (Changing a cookie in the checkout action would make Next
 * re-render the checkout page, which bounces an empty cart to /cart before the
 * shopper reaches the confirmation page.)
 */
export async function markCartConverted(tx: TenantTx, storeId: string, cartId: string) {
  await tx.update(carts).set({ status: "converted" }).where(and(eq(carts.storeId, storeId), eq(carts.id, cartId)));
}
