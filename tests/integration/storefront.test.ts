import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { platformDb, pool } from "@/server/db/platform";
import { customers, orders, products, productVariants, stores, users } from "@/server/db/schema";
import { withTenant, type TenantTx } from "@/server/db/tenant";
import { createCategory } from "@/server/modules/catalog/categories";
import { deleteProduct, saveProduct, type ProductInput } from "@/server/modules/catalog/products";
import { changeOrderStatus } from "@/server/modules/orders/orders";
import { saveShippingMethod } from "@/server/modules/settings/settings";
import { addItem, createCart, loadCartLines, setItemQuantity } from "@/server/modules/storefront/cart";
import { getPublicProduct, listPublicProducts } from "@/server/modules/storefront/catalog";
import { getOrderForShopper, listCustomerOrders, placeOrder, type CheckoutInput } from "@/server/modules/storefront/checkout";
import { customerForToken, loginCustomer, registerCustomer } from "@/server/modules/storefront/customer-auth";
import { systemActor, type StoreActor } from "@/server/modules/_shared/actor";
import { DomainError } from "@/server/modules/_shared/errors";
import { orderViewToken, verifyOrderViewToken } from "@/server/security/tokens";

/*
 * Stage 3 storefront rules against real Postgres (RLS on): public catalog,
 * cart, checkout, customer accounts and who can see which order.
 */

// unstable_cache needs Next's request context; in tests, just call through.
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

let A: StoreActor;
let B: StoreActor;
const v: Record<string, string> = {}; // variant ids by product slug
let lagosOnly: string;
let nationwide: string;
let inactive: string;

const product = (title: string, over: Partial<ProductInput> & { price?: number; stock?: number; track?: boolean } = {}): ProductInput => ({
  title,
  status: "active",
  categoryIds: [],
  options: [],
  images: [],
  variants: [{ optionValues: {}, priceMinor: over.price ?? 1_000_000, stockQuantity: over.stock ?? 10, trackInventory: over.track ?? true, allowBackorder: false }],
  ...over,
});

/** The (only) variant of a product, read inside the transaction that created it. */
async function variantOf(tx: TenantTx, storeId: string, productId: string) {
  const [row] = await tx.select({ id: productVariants.id }).from(productVariants).where(and(eq(productVariants.storeId, storeId), eq(productVariants.productId, productId)));
  return row.id;
}

async function rejects(p: Promise<unknown>, message?: RegExp) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  if (message) expect((err as Error).message).toMatch(message);
  return err as DomainError;
}

const checkout = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({
  email: "shopper@example.com",
  fullName: "Chika Obi",
  phone: "0803 000 0000",
  line1: "12 Allen Avenue",
  city: "Ikeja",
  state: "LA",
  deliveryId: lagosOnly,
  paymentMethod: "pay_on_delivery",
  ...over,
});

/** A fresh cart in store A holding the given lines. */
async function cartWith(lines: Array<[slug: string, qty: number]>, customerId: string | null = null) {
  return withTenant(A.storeId, async (tx) => {
    const cart = await createCart(tx, A.storeId, customerId);
    for (const [slug, quantity] of lines) await addItem(tx, A.storeId, cart.id, { variantId: v[slug], quantity });
    return cart.id;
  });
}

const orderRow = async (id: string) => (await platformDb.select().from(orders).where(eq(orders.id, id)))[0];

const stockOf = async (slug: string) =>
  (await platformDb.select({ s: productVariants.stockQuantity }).from(productVariants).where(eq(productVariants.id, v[slug])))[0].s;

beforeAll(async () => {
  const [owner] = await platformDb.insert(users).values({ name: "S3 Owner", email: `s3-${Date.now()}@t.test` }).returning({ id: users.id });
  const rows = await platformDb
    .insert(stores)
    .values([
      { name: "S3 Store A", subdomain: "s3-a", trialEndsAt: new Date(Date.now() + 864e5) },
      { name: "S3 Store B", subdomain: "s3-b", trialEndsAt: new Date(Date.now() + 864e5) },
    ])
    .returning({ id: stores.id, subdomain: stores.subdomain });
  A = systemActor(rows.find((r) => r.subdomain === "s3-a")!.id, owner.id);
  B = systemActor(rows.find((r) => r.subdomain === "s3-b")!.id, owner.id);

  await withTenant(A.storeId, async (tx) => {
    const shirts = await createCategory(tx, A, { name: "Shirts" });
    for (const [slug, input] of [
      ["ankara-shirt", product("Ankara Shirt", { categoryIds: [shirts.id], stock: 3 })],
      ["straw-hat", product("Straw Hat", { price: 300_000, track: false })],
      ["last-one", product("Last One", { stock: 1, price: 200_000 })],
      ["draft-dress", product("Draft Dress", { status: "draft" })],
      ["old-bag", product("Old Bag")],
    ] as const) {
      const { id } = await saveProduct(tx, A, null, input);
      v[slug] = await variantOf(tx, A.storeId, id);
      if (slug === "old-bag") await deleteProduct(tx, A, id);
    }
    lagosOnly = (await saveShippingMethod(tx, A, null, { name: "Lagos dispatch", priceMinor: 150_000, freeOverMinor: 5_000_000, regions: ["LA"] })).id;
    nationwide = (await saveShippingMethod(tx, A, null, { name: "GIG nationwide", priceMinor: 400_000, regions: [] })).id;
    inactive = (await saveShippingMethod(tx, A, null, { name: "Old courier", priceMinor: 0, regions: [], isActive: false })).id;
  });
  await withTenant(B.storeId, async (tx) => {
    const { id } = await saveProduct(tx, B, null, product("B Shirt"));
    v["b-shirt"] = await variantOf(tx, B.storeId, id);
  });
});

afterAll(async () => {
  await pool.end();
});

describe("public catalog", () => {
  it("lists only active, undeleted products of this store", async () => {
    const { rows, total } = await listPublicProducts(A.storeId, {});
    expect(rows.map((r) => r.slug).sort()).toEqual(["ankara-shirt", "last-one", "straw-hat"]);
    expect(total).toBe(3);
    expect(await getPublicProduct(A.storeId, "draft-dress")).toBeNull();
    expect(await getPublicProduct(A.storeId, "old-bag")).toBeNull();
    expect(await getPublicProduct(A.storeId, "b-shirt")).toBeNull();
  });

  it("filters by category, searches and sorts", async () => {
    expect((await listPublicProducts(A.storeId, { categorySlug: "shirts" })).rows.map((r) => r.slug)).toEqual(["ankara-shirt"]);
    expect((await listPublicProducts(A.storeId, { q: "straw" })).rows.map((r) => r.slug)).toEqual(["straw-hat"]);
    const cheapest = (await listPublicProducts(A.storeId, { sort: "price_asc" })).rows.map((r) => r.minPrice);
    expect(cheapest).toEqual([...cheapest].sort((a, b) => a - b));
  });

  it("shows availability per variant", async () => {
    const p = await getPublicProduct(A.storeId, "ankara-shirt");
    expect(p?.variants[0]).toMatchObject({ available: true, maxQty: 3, lowStock: true });
  });
});

describe("cart", () => {
  it("merges repeated adds and caps at stock", async () => {
    const cartId = await cartWith([["ankara-shirt", 1]]);
    await withTenant(A.storeId, (tx) => addItem(tx, A.storeId, cartId, { variantId: v["ankara-shirt"], quantity: 2 }));
    await rejects(withTenant(A.storeId, (tx) => addItem(tx, A.storeId, cartId, { variantId: v["ankara-shirt"], quantity: 1 })), /Only 3 left/);
    const lines = await withTenant(A.storeId, (tx) => loadCartLines(tx, A.storeId, cartId));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 3, unitPrice: 1_000_000, lineTotal: 3_000_000, issue: null });
  });

  it("refuses drafts, deleted products and other stores' variants", async () => {
    const cartId = await cartWith([]);
    for (const slug of ["draft-dress", "old-bag", "b-shirt"]) {
      await rejects(withTenant(A.storeId, (tx) => addItem(tx, A.storeId, cartId, { variantId: v[slug], quantity: 1 })), /no longer available/);
    }
  });

  it("changes and removes lines only within its own cart", async () => {
    const mine = await cartWith([["straw-hat", 1]]);
    const other = await cartWith([["straw-hat", 1]]);
    const [otherLine] = await withTenant(A.storeId, (tx) => loadCartLines(tx, A.storeId, other));
    // Someone else's item id: not found in my cart, and deleting it is a no-op.
    await rejects(withTenant(A.storeId, (tx) => setItemQuantity(tx, A.storeId, mine, otherLine.itemId, 5)), /isn't in your cart/);
    await withTenant(A.storeId, (tx) => setItemQuantity(tx, A.storeId, mine, otherLine.itemId, 0));
    expect(await withTenant(A.storeId, (tx) => loadCartLines(tx, A.storeId, other))).toHaveLength(1);

    const [line] = await withTenant(A.storeId, (tx) => loadCartLines(tx, A.storeId, mine));
    await withTenant(A.storeId, (tx) => setItemQuantity(tx, A.storeId, mine, line.itemId, 4));
    expect((await withTenant(A.storeId, (tx) => loadCartLines(tx, A.storeId, mine)))[0].quantity).toBe(4);
    await withTenant(A.storeId, (tx) => setItemQuantity(tx, A.storeId, mine, line.itemId, 0));
    expect(await withTenant(A.storeId, (tx) => loadCartLines(tx, A.storeId, mine))).toHaveLength(0);
  });

  it("flags lines that changed since they were added", async () => {
    const cartId = await cartWith([["ankara-shirt", 2]]);
    await platformDb.update(productVariants).set({ stockQuantity: 1 }).where(eq(productVariants.id, v["ankara-shirt"]));
    expect((await withTenant(A.storeId, (tx) => loadCartLines(tx, A.storeId, cartId)))[0]).toMatchObject({ issue: "insufficient_stock", maxQty: 1 });
    await rejects(withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, cartId, checkout(), null)), /changed since you added/);

    await platformDb.update(products).set({ status: "archived" }).where(eq(products.slug, "ankara-shirt"));
    expect((await withTenant(A.storeId, (tx) => loadCartLines(tx, A.storeId, cartId)))[0]).toMatchObject({ issue: "unavailable", maxQty: 0 });
    await platformDb.update(products).set({ status: "active" }).where(eq(products.slug, "ankara-shirt"));
    await platformDb.update(productVariants).set({ stockQuantity: 3 }).where(eq(productVariants.id, v["ankara-shirt"]));
  });
});

describe("checkout", () => {
  it("prices from the database, reserves stock and records pay on delivery", async () => {
    const cartId = await cartWith([["ankara-shirt", 2], ["straw-hat", 1]]);
    // The price changes after the shopper added it: the order uses the current one.
    await platformDb.update(productVariants).set({ priceMinor: 1_200_000 }).where(eq(productVariants.id, v["ankara-shirt"]));
    const before = await stockOf("ankara-shirt");
    const order = await withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, cartId, checkout(), null));

    const row = await orderRow(order.id);
    expect(row).toMatchObject({
      subtotalMinor: 2 * 1_200_000 + 300_000,
      shippingMinor: 150_000,
      totalMinor: 2 * 1_200_000 + 300_000 + 150_000,
      shippingMethodName: "Lagos dispatch",
      paymentMethod: "pay_on_delivery",
      status: "pending",
      inventoryCommitted: true,
      placedSignedIn: false,
    });
    expect(row.shippingAddress).toMatchObject({ state: "Lagos", city: "Ikeja" });
    expect(await stockOf("ankara-shirt")).toBe(before - 2);

    // Cancelling gives the stock back.
    await withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, order.id, { to: "cancelled" }));
    expect(await stockOf("ankara-shirt")).toBe(before);
    await platformDb.update(productVariants).set({ priceMinor: 1_000_000 }).where(eq(productVariants.id, v["ankara-shirt"]));
  });

  it("applies free delivery over the threshold", async () => {
    const cartId = await cartWith([["straw-hat", 20]]); // 20 × ₦3,000 = ₦60,000 ≥ ₦50,000
    const order = await withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, cartId, checkout(), null));
    expect((await orderRow(order.id)).shippingMinor).toBe(0);
  });

  it("only accepts an active delivery option that covers the state", async () => {
    const cartId = await cartWith([["straw-hat", 1]]);
    const err = await rejects(withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, cartId, checkout({ state: "KN" }), null)), /isn't available for your state/);
    expect(err.fieldErrors?.deliveryId).toBeDefined();
    await rejects(withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, cartId, checkout({ deliveryId: inactive }), null)), /isn't available/);
    const order = await withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, cartId, checkout({ state: "KN", deliveryId: nationwide }), null));
    expect((await orderRow(order.id)).shippingMinor).toBe(400_000);
  });

  it("validates the form and refuses an empty cart", async () => {
    const empty = await cartWith([]);
    await rejects(withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, empty, checkout(), null)), /cart is empty/);
    await expect(withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, empty, checkout({ phone: "call me" }), null))).rejects.toThrow(/valid phone/);
    await expect(withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, empty, checkout({ state: "ZZ" }), null))).rejects.toThrow(/Choose your state/);
  });

  it("sells the last unit once when two shoppers check out at the same time", async () => {
    const [c1, c2] = [await cartWith([["last-one", 1]]), await cartWith([["last-one", 1]])];
    const results = await Promise.allSettled([
      withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, c1, checkout({ email: "one@example.com" }), null)),
      withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, c2, checkout({ email: "two@example.com" }), null)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toBeInstanceOf(DomainError);
    expect(failed.reason.message).toMatch(/stock just changed/);
    expect(await stockOf("last-one")).toBe(0);
  });
});

describe("customer accounts and order visibility", () => {
  const email = "returning@example.com";
  let guestOrderId: string;

  it("an account for a guest email doesn't reveal the guest's orders until verified", async () => {
    const cartId = await cartWith([["straw-hat", 1]]);
    guestOrderId = (await withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, cartId, checkout({ email, fullName: "Guest Name" }), null))).id;

    const { customerId, token } = await withTenant(A.storeId, (tx) =>
      registerCustomer(tx, A.storeId, { name: "Someone Else", email: email.toUpperCase(), password: "long-password-1" }),
    );
    const customer = (await withTenant(A.storeId, (tx) => customerForToken(tx, A.storeId, token)))!;
    expect(customer.id).toBe(customerId);
    expect(customer.name).toBe("Guest Name"); // the store's existing record is kept
    expect(await withTenant(A.storeId, (tx) => listCustomerOrders(tx, A.storeId, customer))).toEqual([]);
    expect(await withTenant(A.storeId, (tx) => getOrderForShopper(tx, A.storeId, guestOrderId, { tokenValid: false, customer }))).toBeNull();

    // Orders placed while signed in are theirs.
    const cart2 = await cartWith([["straw-hat", 2]], customer.id);
    const mine = await withTenant(A.storeId, (tx) => placeOrder(tx, A.storeId, cart2, checkout({ email: "ignored@example.com" }), customer));
    expect(await orderRow(mine.id)).toMatchObject({ email, placedSignedIn: true });
    const listed = await withTenant(A.storeId, (tx) => listCustomerOrders(tx, A.storeId, customer));
    expect(listed.map((o) => o.id)).toEqual([mine.id]);
    expect(listed[0].itemCount).toBe(2);

    // After email verification (Stage 10) the guest history appears too.
    await platformDb.update(customers).set({ emailVerifiedAt: new Date() }).where(eq(customers.id, customer.id));
    const verified = (await withTenant(A.storeId, (tx) => customerForToken(tx, A.storeId, token)))!;
    expect((await withTenant(A.storeId, (tx) => listCustomerOrders(tx, A.storeId, verified))).map((o) => o.id).sort()).toEqual([guestOrderId, mine.id].sort());
  });

  it("refuses a second registration and wrong passwords", async () => {
    await rejects(withTenant(A.storeId, (tx) => registerCustomer(tx, A.storeId, { name: "Again", email, password: "another-password" })), /already exists/);
    await rejects(withTenant(A.storeId, (tx) => loginCustomer(tx, A.storeId, { email, password: "wrong-password" })), /Incorrect email or password/);
    await rejects(withTenant(A.storeId, (tx) => loginCustomer(tx, A.storeId, { email: "nobody@example.com", password: "whatever" })), /Incorrect email or password/);
    const { token } = await withTenant(A.storeId, (tx) => loginCustomer(tx, A.storeId, { email, password: "long-password-1" }));
    expect((await withTenant(A.storeId, (tx) => customerForToken(tx, A.storeId, token)))?.email).toBe(email);
  });

  it("accounts and sessions belong to one store", async () => {
    const { token } = await withTenant(A.storeId, (tx) => loginCustomer(tx, A.storeId, { email, password: "long-password-1" }));
    expect(await withTenant(B.storeId, (tx) => customerForToken(tx, B.storeId, token))).toBeNull();
    await rejects(withTenant(B.storeId, (tx) => loginCustomer(tx, B.storeId, { email, password: "long-password-1" })), /Incorrect/);
    // Same email can open a separate account on store B.
    await withTenant(B.storeId, (tx) => registerCustomer(tx, B.storeId, { name: "B Shopper", email, password: "different-pass-2" }));
  });

  it("the order link token opens only its own order", async () => {
    const t = orderViewToken(guestOrderId);
    expect(verifyOrderViewToken(guestOrderId, t)).toBe(true);
    expect(verifyOrderViewToken(guestOrderId, t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBe(false);
    expect(verifyOrderViewToken(guestOrderId, undefined)).toBe(false);
    expect(verifyOrderViewToken("0197c9a2-0000-7000-8000-000000000000", t)).toBe(false);

    const byToken = await withTenant(A.storeId, (tx) => getOrderForShopper(tx, A.storeId, guestOrderId, { tokenValid: true, customer: null }));
    expect(byToken?.items).toHaveLength(1);
    expect(await withTenant(A.storeId, (tx) => getOrderForShopper(tx, A.storeId, guestOrderId, { tokenValid: false, customer: null }))).toBeNull();
    // Another store can't read it even with a valid token.
    expect(await withTenant(B.storeId, (tx) => getOrderForShopper(tx, B.storeId, guestOrderId, { tokenValid: true, customer: null }))).toBeNull();
  });
});
