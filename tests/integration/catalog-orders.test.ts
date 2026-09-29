import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformDb, pool } from "@/server/db/platform";
import { auditLogs, categories, media, orders, productVariants, stores, users } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { createCategory, deleteCategory, listCategories } from "@/server/modules/catalog/categories";
import { deleteProduct, getProductForEdit, listProducts, saveProduct, type ProductInput } from "@/server/modules/catalog/products";
import { getCustomer, listCustomers } from "@/server/modules/customers/customers";
import { confirmImageUpload, prepareImageUpload } from "@/server/modules/media/uploads";
import { changeOrderStatus, createOrder, getOrder, listOrders } from "@/server/modules/orders/orders";
import { getOverview } from "@/server/modules/overview/overview";
import { deleteShippingMethod, saveShippingMethod, updateSettings } from "@/server/modules/settings/settings";
import { systemActor, type StoreActor } from "@/server/modules/_shared/actor";
import { DomainError } from "@/server/modules/_shared/errors";
import { writeLocalObject } from "@/server/storage/local";

/*
 * Stage 2 business rules against real Postgres, through the same services the
 * dashboard uses (always inside withTenant, so RLS is on).
 */

let A: StoreActor;
let B: StoreActor;

const address = { fullName: "Ada Obi", phone: "08030000000", line1: "1 Marina", city: "Lagos", state: "Lagos", country: "NG" };
const baseProduct = (over: Partial<ProductInput> = {}): ProductInput => ({
  title: "Test Shirt",
  status: "active",
  categoryIds: [],
  options: [],
  variants: [{ optionValues: {}, priceMinor: 500_000, stockQuantity: 5, trackInventory: true, allowBackorder: false }],
  images: [],
  ...over,
});

async function expectDomainError(p: Promise<unknown>, message?: RegExp) {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  if (message) expect((err as Error).message).toMatch(message);
  return err as DomainError;
}

beforeAll(async () => {
  const [owner] = await platformDb.insert(users).values({ name: "S2 Owner", email: `s2-${Date.now()}@t.test` }).returning({ id: users.id });
  const rows = await platformDb
    .insert(stores)
    .values([
      { name: "S2 Store A", subdomain: "s2-a", trialEndsAt: new Date(Date.now() + 864e5) },
      { name: "S2 Store B", subdomain: "s2-b", trialEndsAt: new Date(Date.now() + 864e5) },
    ])
    .returning({ id: stores.id, subdomain: stores.subdomain });
  A = systemActor(rows.find((r) => r.subdomain === "s2-a")!.id, owner.id);
  B = systemActor(rows.find((r) => r.subdomain === "s2-b")!.id, owner.id);
});

afterAll(async () => {
  await pool.end();
});

describe("products", () => {
  it("creates a product with a variant for every option combination", async () => {
    const { id, slug } = await withTenant(A.storeId, (tx) =>
      saveProduct(tx, A, null, {
        ...baseProduct({ title: "Kaftan" }),
        options: [
          { name: "Size", values: ["S", "M"] },
          { name: "Colour", values: ["Red", "Green"] },
        ],
        variants: ["S", "M"].flatMap((Size) =>
          ["Red", "Green"].map((Colour) => ({ optionValues: { Size, Colour }, priceMinor: 1_000_000, stockQuantity: 2, trackInventory: true, allowBackorder: false, sku: `K-${Size}-${Colour}` })),
        ),
      }),
    );
    expect(slug).toBe("kaftan");
    const p = await withTenant(A.storeId, (tx) => getProductForEdit(tx, A.storeId, id));
    expect(p?.variants.map((v) => v.title)).toEqual(["S / Red", "S / Green", "M / Red", "M / Green"]);
  });

  it("gives duplicate titles unique URL slugs, but rejects an explicit duplicate slug", async () => {
    const a = await withTenant(A.storeId, (tx) => saveProduct(tx, A, null, baseProduct({ title: "Cap" })));
    const b = await withTenant(A.storeId, (tx) => saveProduct(tx, A, null, baseProduct({ title: "Cap" })));
    expect([a.slug, b.slug]).toEqual(["cap", "cap-2"]);
    await expectDomainError(withTenant(A.storeId, (tx) => saveProduct(tx, A, null, baseProduct({ title: "Other", slug: "cap" }))));
    // Same slug in ANOTHER store is fine: slugs are per store.
    const other = await withTenant(B.storeId, (tx) => saveProduct(tx, B, null, baseProduct({ title: "Cap" })));
    expect(other.slug).toBe("cap");
  });

  it("validates variants against options and prices", async () => {
    const bad = (over: Partial<ProductInput>) => withTenant(A.storeId, (tx) => saveProduct(tx, A, null, baseProduct(over))).catch((e) => e);
    // variant doesn't match options
    expect((await bad({ options: [{ name: "Size", values: ["S"] }] })).name).toBe("ZodError");
    // compare-at must be higher than price
    expect(
      (await bad({ variants: [{ optionValues: {}, priceMinor: 5000, compareAtPriceMinor: 4000, stockQuantity: 1, trackInventory: true, allowBackorder: false }] })).name,
    ).toBe("ZodError");
    // duplicate SKUs
    expect(
      (
        await bad({
          options: [{ name: "Size", values: ["S", "M"] }],
          variants: ["S", "M"].map((Size) => ({ optionValues: { Size }, priceMinor: 1, stockQuantity: 1, trackInventory: true, allowBackorder: false, sku: "SAME" })),
        })
      ).name,
    ).toBe("ZodError");
  });

  it("keeps variant ids on edit, soft-deletes removed variants and handles swapped SKUs", async () => {
    const opts = [{ name: "Size", values: ["S", "M", "L"] }];
    const mk = (Size: string, sku: string) => ({ optionValues: { Size }, priceMinor: 100, stockQuantity: 1, trackInventory: true, allowBackorder: false, sku });
    const { id } = await withTenant(A.storeId, (tx) =>
      saveProduct(tx, A, null, baseProduct({ title: "Swap", options: opts, variants: [mk("S", "SW-S"), mk("M", "SW-M"), mk("L", "SW-L")] })),
    );
    const before = (await withTenant(A.storeId, (tx) => getProductForEdit(tx, A.storeId, id)))!;
    const idOf = (t: string) => before.variants.find((v) => v.title === t)!.id;

    // Drop L, swap SKUs of S and M (would violate the unique index without the two-phase update).
    await withTenant(A.storeId, (tx) =>
      saveProduct(tx, A, id, {
        ...baseProduct({ title: "Swap" }),
        options: [{ name: "Size", values: ["S", "M"] }],
        variants: [
          { ...mk("S", "SW-M"), id: idOf("S") },
          { ...mk("M", "SW-S"), id: idOf("M") },
        ],
      }),
    );
    const after = (await withTenant(A.storeId, (tx) => getProductForEdit(tx, A.storeId, id)))!;
    expect(after.variants.map((v) => [v.id, v.sku])).toEqual([
      [idOf("S"), "SW-M"],
      [idOf("M"), "SW-S"],
    ]);
    const [removed] = await platformDb.select().from(productVariants).where(eq(productVariants.id, idOf("L")));
    expect(removed.deletedAt).not.toBeNull();
  });

  it("cannot attach another store's category or image", async () => {
    const catB = await withTenant(B.storeId, (tx) => createCategory(tx, B, { name: "B only" }));
    await expectDomainError(withTenant(A.storeId, (tx) => saveProduct(tx, A, null, baseProduct({ categoryIds: [catB.id] }))), /no longer exists/);

    const [mediaB] = await platformDb
      .insert(media)
      .values({ storeId: B.storeId, storageKey: `stores/${B.storeId}/media/x.png`, contentType: "image/png", byteSize: 10 })
      .returning({ id: media.id });
    await expectDomainError(
      withTenant(A.storeId, (tx) => saveProduct(tx, A, null, baseProduct({ images: [{ mediaId: mediaB.id }] }))),
      /no longer exists/,
    );
  });

  it("lists with correct per-product aggregates, search and filters", async () => {
    const cat = await withTenant(A.storeId, (tx) => createCategory(tx, A, { name: "Listing" }));
    await withTenant(A.storeId, (tx) =>
      saveProduct(tx, A, null, {
        ...baseProduct({ title: "Agbada Deluxe", categoryIds: [cat.id] }),
        options: [{ name: "Size", values: ["M", "L"] }],
        variants: [
          { optionValues: { Size: "M" }, priceMinor: 2_000_000, stockQuantity: 3, trackInventory: true, allowBackorder: false, sku: "AGB-M" },
          { optionValues: { Size: "L" }, priceMinor: 2_500_000, stockQuantity: 4, trackInventory: true, allowBackorder: false, sku: "AGB-L" },
        ],
      }),
    );
    const byTitle = await withTenant(A.storeId, (tx) => listProducts(tx, A.storeId, { q: "agbada" }));
    expect(byTitle.rows).toHaveLength(1);
    expect(byTitle.rows[0]).toMatchObject({ variantCount: 2, minPrice: 2_000_000, maxPrice: 2_500_000, stock: 7 });
    expect((await withTenant(A.storeId, (tx) => listProducts(tx, A.storeId, { q: "AGB-L" }))).rows).toHaveLength(1);
    expect((await withTenant(A.storeId, (tx) => listProducts(tx, A.storeId, { categoryId: cat.id }))).total).toBe(1);
    // Store B never sees store A's products.
    expect((await withTenant(B.storeId, (tx) => listProducts(tx, B.storeId, { q: "agbada" }))).total).toBe(0);
  });

  it("soft-deletes products and frees the slug and SKUs", async () => {
    const { id } = await withTenant(A.storeId, (tx) =>
      saveProduct(tx, A, null, baseProduct({ title: "Gone", variants: [{ optionValues: {}, priceMinor: 1, stockQuantity: 0, trackInventory: true, allowBackorder: false, sku: "GONE-1" }] })),
    );
    await withTenant(A.storeId, (tx) => deleteProduct(tx, A, id));
    expect(await withTenant(A.storeId, (tx) => getProductForEdit(tx, A.storeId, id))).toBeNull();
    const again = await withTenant(A.storeId, (tx) =>
      saveProduct(tx, A, null, baseProduct({ title: "Gone", variants: [{ optionValues: {}, priceMinor: 1, stockQuantity: 0, trackInventory: true, allowBackorder: false, sku: "GONE-1" }] })),
    );
    expect(again.slug).toBe("gone");
  });
});

describe("categories", () => {
  it("prevents cycles and moves children to the top when a parent is deleted", async () => {
    const parent = await withTenant(A.storeId, (tx) => createCategory(tx, A, { name: "Parent" }));
    const child = await withTenant(A.storeId, (tx) => createCategory(tx, A, { name: "Child", parentId: parent.id }));
    const { updateCategory } = await import("@/server/modules/catalog/categories");
    await expectDomainError(withTenant(A.storeId, (tx) => updateCategory(tx, A, parent.id, { name: "Parent", parentId: child.id })), /inside itself/);

    await withTenant(A.storeId, (tx) => deleteCategory(tx, A, parent.id));
    const [c] = await platformDb.select().from(categories).where(eq(categories.id, child.id));
    expect(c.parentId).toBeNull();
    expect(c.storeId).toBe(A.storeId); // SET NULL (parent_id) only, store_id untouched
  });

  it("lists as a tree with product counts", async () => {
    const tree = await withTenant(A.storeId, (tx) => listCategories(tx, A.storeId));
    const listing = tree.find((c) => c.name === "Listing");
    expect(listing?.productCount).toBe(1);
  });
});

describe("orders & inventory", () => {
  let variantId: string;
  let shippingId: string;

  beforeAll(async () => {
    const { id } = await withTenant(A.storeId, (tx) =>
      saveProduct(tx, A, null, baseProduct({ title: "Stocked", variants: [{ optionValues: {}, priceMinor: 300_000, stockQuantity: 5, trackInventory: true, allowBackorder: false }] })),
    );
    variantId = (await withTenant(A.storeId, (tx) => getProductForEdit(tx, A.storeId, id)))!.variants[0].id;
    ({ id: shippingId } = await withTenant(A.storeId, (tx) =>
      saveShippingMethod(tx, A, null, { name: "Courier", priceMinor: 200_000, freeOverMinor: 1_000_000 }),
    ));
  });

  const stock = async () => (await platformDb.select({ s: productVariants.stockQuantity }).from(productVariants).where(eq(productVariants.id, variantId)))[0].s;

  it("prices from the database, applies free-shipping thresholds and numbers orders per store", async () => {
    const o1 = await withTenant(A.storeId, (tx) =>
      createOrder(tx, A.storeId, { email: "Buyer@Example.com", items: [{ variantId, quantity: 2 }], shippingMethodId: shippingId, shippingAddress: address }),
    );
    expect(o1.totalMinor).toBe(2 * 300_000 + 200_000);
    const o2 = await withTenant(A.storeId, (tx) =>
      createOrder(tx, A.storeId, { email: "buyer@example.com", items: [{ variantId, quantity: 4 }], shippingMethodId: shippingId, shippingAddress: address }),
    );
    expect(o2.totalMinor).toBe(4 * 300_000); // over ₦10,000 -> free delivery
    expect(o2.orderNumber).toBe(o1.orderNumber + 1);
    // Same email (any case) -> same customer
    const customers = await withTenant(A.storeId, (tx) => listCustomers(tx, A.storeId, { q: "buyer@" }));
    expect(customers.total).toBe(1);
  });

  it("can't order another store's variant", async () => {
    await expectDomainError(
      withTenant(B.storeId, (tx) => createOrder(tx, B.storeId, { email: "x@buyers.ng", items: [{ variantId, quantity: 1 }], shippingAddress: address })),
      /no longer available/,
    );
  });

  it("takes stock when paid, refuses to oversell, and returns stock on cancel", async () => {
    expect(await stock()).toBe(5);
    const small = await withTenant(A.storeId, (tx) => createOrder(tx, A.storeId, { email: "a@buyers.ng", items: [{ variantId, quantity: 3 }], shippingAddress: address }));
    const big = await withTenant(A.storeId, (tx) => createOrder(tx, A.storeId, { email: "d@buyers.ng", items: [{ variantId, quantity: 3 }], shippingAddress: address }));

    await withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, small.id, { to: "paid" }));
    expect(await stock()).toBe(2);

    await expectDomainError(withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, big.id, { to: "paid" })), /Not enough stock/);
    expect(await stock()).toBe(2); // nothing partially applied
    expect((await withTenant(A.storeId, (tx) => getOrder(tx, A.storeId, big.id)))?.status).toBe("pending");

    await withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, small.id, { to: "cancelled", note: "Customer changed mind" }));
    expect(await stock()).toBe(5);
    const o = await withTenant(A.storeId, (tx) => getOrder(tx, A.storeId, small.id));
    expect(o?.inventoryCommitted).toBe(false);
    expect(o?.history.map((h) => h.toStatus)).toEqual(["pending", "paid", "cancelled"]);
  });

  it("enforces the status flow; pay-on-delivery orders become paid when delivered", async () => {
    const o = await withTenant(A.storeId, (tx) => createOrder(tx, A.storeId, { email: "cod@buyers.ng", items: [{ variantId, quantity: 1 }], shippingAddress: address }));
    await expectDomainError(withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, o.id, { to: "delivered" })), /can't be marked/);
    await withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, o.id, { to: "shipped", trackingNumber: "GIG-1" }));
    expect(await stock()).toBe(4); // shipping an unpaid order also takes stock
    await withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, o.id, { to: "delivered" }));
    const done = await withTenant(A.storeId, (tx) => getOrder(tx, A.storeId, o.id));
    expect(done?.paidAt).not.toBeNull();
    expect(done?.trackingNumber).toBe("GIG-1");
    await expectDomainError(withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, o.id, { to: "cancelled" })));
  });

  it("only one of two concurrent transitions wins", async () => {
    const o = await withTenant(A.storeId, (tx) => createOrder(tx, A.storeId, { email: "race@buyers.ng", items: [{ variantId, quantity: 1 }], shippingAddress: address }));
    const results = await Promise.allSettled([
      withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, o.id, { to: "paid" })),
      withTenant(A.storeId, (tx) => changeOrderStatus(tx, A, o.id, { to: "paid" })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stock()).toBe(3); // taken once, not twice
  });

  it("lists and aggregates orders and customers correctly (correlated subqueries)", async () => {
    const list = await withTenant(A.storeId, (tx) => listOrders(tx, A.storeId, { q: "buyer@example.com" }));
    expect(list.rows.map((r) => r.itemCount).sort()).toEqual([2, 4]);
    const byNumber = await withTenant(A.storeId, (tx) => listOrders(tx, A.storeId, { q: `#${list.rows[0].orderNumber}` }));
    expect(byNumber.total).toBe(1);

    const cod = await withTenant(A.storeId, (tx) => listCustomers(tx, A.storeId, { q: "cod@" }));
    expect(cod.rows[0]).toMatchObject({ orderCount: 1, totalSpentMinor: 300_000 });
    const detail = await withTenant(A.storeId, (tx) => getCustomer(tx, A.storeId, cod.rows[0].id));
    expect(detail?.orders).toHaveLength(1);

    const overview = await withTenant(A.storeId, (tx) => getOverview(tx, A.storeId));
    expect(overview.salesMinor).toBeGreaterThan(0);
    expect(overview.topProducts[0]?.title).toBe("Stocked");
    // Store B has no orders, and can't see A's.
    expect((await withTenant(B.storeId, (tx) => listOrders(tx, B.storeId, {}))).total).toBe(0);
  });

  it("keeps the delivery name on orders when a delivery option is deleted", async () => {
    const o = await withTenant(A.storeId, (tx) =>
      createOrder(tx, A.storeId, { email: "ship@buyers.ng", items: [{ variantId, quantity: 1 }], shippingMethodId: shippingId, shippingAddress: address }),
    );
    await withTenant(A.storeId, (tx) => deleteShippingMethod(tx, A, shippingId));
    const [row] = await platformDb.select().from(orders).where(eq(orders.id, o.id));
    expect(row.shippingMethodId).toBeNull();
    expect(row.shippingMethodName).toBe("Courier");
  });
});

describe("settings", () => {
  it("updates allowed fields only", async () => {
    await withTenant(A.storeId, (tx) =>
      updateSettings(tx, A, { name: "Renamed A", contactEmail: "hi@a.test", currency: "GHS", timezone: "Africa/Accra" }),
    );
    const [s] = await platformDb.select().from(stores).where(eq(stores.id, A.storeId));
    expect(s).toMatchObject({ name: "Renamed A", currency: "GHS", subdomain: "s2-a", billingStatus: "trialing" });
    await expectDomainError(withTenant(A.storeId, (tx) => updateSettings(tx, A, { name: "x", currency: "NGN", timezone: "Africa/Lagos" })).catch((e) => {
      throw e.name === "ZodError" ? new DomainError("zod") : e;
    }));
  });
});

describe("image uploads (local driver)", () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

  it("records a real image and rejects a fake one", async () => {
    const good = await prepareImageUpload(A.storeId, { contentType: "image/png", size: PNG.length });
    expect(good.key).toMatch(new RegExp(`^stores/${A.storeId}/media/`));
    await writeLocalObject(good.key, PNG, "image/png");
    const saved = await withTenant(A.storeId, (tx) => confirmImageUpload(tx, A, { key: good.key }));
    expect(saved.url).toContain(good.key);

    const fake = await prepareImageUpload(A.storeId, { contentType: "image/png", size: 20 });
    await writeLocalObject(fake.key, new TextEncoder().encode("<html>not an image</html>"), "image/png");
    await expectDomainError(withTenant(A.storeId, (tx) => confirmImageUpload(tx, A, { key: fake.key })), /valid image/);
  });

  it("won't confirm another store's upload key", async () => {
    const other = await prepareImageUpload(B.storeId, { contentType: "image/png", size: PNG.length });
    await writeLocalObject(other.key, PNG, "image/png");
    await expectDomainError(withTenant(A.storeId, (tx) => confirmImageUpload(tx, A, { key: other.key })), /does not belong/);
  });

  it("rejects non-image types and oversized files up front", async () => {
    await expect(prepareImageUpload(A.storeId, { contentType: "text/html" as never, size: 10 })).rejects.toThrow();
    await expectDomainError(prepareImageUpload(A.storeId, { contentType: "image/png", size: 50 * 1024 * 1024 }), /MB or smaller/);
  });
});

describe("audit log", () => {
  it("records changes and is append-only, even for the owner connection", async () => {
    const [entry] = await platformDb.select().from(auditLogs).where(and(eq(auditLogs.storeId, A.storeId), eq(auditLogs.action, "product.create"))).limit(1);
    expect(entry.actorUserId).toBe(A.userId);
    await expect(platformDb.update(auditLogs).set({ action: "tampered" }).where(eq(auditLogs.id, entry.id))).rejects.toThrow();
    await expect(platformDb.delete(auditLogs).where(eq(auditLogs.id, entry.id))).rejects.toThrow();
  });

  it("tenants only see their own audit entries", async () => {
    const rows = await withTenant(B.storeId, (tx) => tx.select({ storeId: auditLogs.storeId }).from(auditLogs));
    expect(rows.every((r) => r.storeId === B.storeId)).toBe(true);
    const [{ n }] = (await platformDb.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM audit_logs WHERE store_id = ${A.storeId}`)).rows;
    expect(n).toBeGreaterThan(0);
  });
});
