/**
 * Demo catalog + orders for a store, created through the real services (so the
 * seed exercises the same validation, RLS and inventory rules as the app).
 * Called from seed.ts --demo. Needs `--conditions=react-server` (server-only imports).
 */
import { count, eq, sql } from "drizzle-orm";
import { orders, products } from "../src/server/db/schema";
import { withTenant } from "../src/server/db/tenant";
import { createCategory } from "../src/server/modules/catalog/categories";
import { saveProduct, type ProductInput } from "../src/server/modules/catalog/products";
import { changeOrderStatus, createOrder } from "../src/server/modules/orders/orders";
import { saveShippingMethod } from "../src/server/modules/settings/settings";
import { systemActor } from "../src/server/modules/_shared/actor";

const naira = (n: number) => Math.round(n * 100);

type Variant = ProductInput["variants"][number];
const v = (optionValues: Record<string, string>, price: number, stock: number, extra: Partial<Variant> = {}): Variant => ({
  optionValues,
  priceMinor: naira(price),
  stockQuantity: stock,
  trackInventory: true,
  allowBackorder: false,
  ...extra,
});

export async function seedDemoCatalog(storeId: string, ownerId: string): Promise<boolean> {
  const actor = systemActor(storeId, ownerId);
  return withTenant(storeId, async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(products).where(eq(products.storeId, storeId));
    if (n > 0) return false; // already seeded

    const women = await createCategory(tx, actor, { name: "Women", position: 1 });
    const dresses = await createCategory(tx, actor, { name: "Dresses", parentId: women.id });
    const men = await createCategory(tx, actor, { name: "Men", position: 2 });
    const accessories = await createCategory(tx, actor, { name: "Accessories", position: 3 });

    const dress = await saveProduct(tx, actor, null, {
      title: "Ankara Wrap Dress",
      description: "Hand-finished wrap dress in 100% cotton Ankara print.\nMade in Lagos.",
      status: "active",
      isFeatured: true,
      categoryIds: [women.id, dresses.id],
      options: [
        { name: "Size", values: ["S", "M", "L"] },
        { name: "Colour", values: ["Blue", "Orange"] },
      ],
      variants: ["S", "M", "L"].flatMap((size) =>
        ["Blue", "Orange"].map((colour) => v({ Size: size, Colour: colour }, 18_500, size === "M" ? 8 : 4, { sku: `AWD-${size}-${colour[0]}` })),
      ),
      images: [],
    });
    const shirt = await saveProduct(tx, actor, null, {
      title: "Adire Tie-Dye Shirt",
      description: "Indigo adire, relaxed fit.",
      status: "active",
      categoryIds: [men.id],
      options: [{ name: "Size", values: ["M", "L", "XL"] }],
      variants: ["M", "L", "XL"].map((size) => v({ Size: size }, 12_000, 10, { compareAtPriceMinor: naira(15_000), sku: `ADS-${size}` })),
      images: [],
    });
    const necklace = await saveProduct(tx, actor, null, {
      title: "Beaded Coral Necklace",
      status: "active",
      categoryIds: [accessories.id],
      options: [],
      variants: [v({}, 6_500, 3, { sku: "BCN-1" })],
      images: [],
    });
    await saveProduct(tx, actor, null, {
      title: "Leather Sandals",
      status: "active",
      categoryIds: [men.id, women.id],
      options: [{ name: "Size", values: ["40", "41", "42", "43"] }],
      variants: ["40", "41", "42", "43"].map((size) => v({ Size: size }, 22_000, 6)),
      images: [],
    });
    await saveProduct(tx, actor, null, {
      title: "Aso Oke Cap",
      status: "draft",
      categoryIds: [accessories.id],
      options: [],
      variants: [v({}, 9_000, 0, { trackInventory: false })],
      images: [],
    });

    const lagos = await saveShippingMethod(tx, actor, null, {
      name: "Lagos delivery",
      priceMinor: naira(2_500),
      regions: ["LA"],
      minDays: 1,
      maxDays: 2,
    });
    const nationwide = await saveShippingMethod(tx, actor, null, {
      name: "Nationwide delivery",
      priceMinor: naira(4_500),
      freeOverMinor: naira(100_000),
      minDays: 3,
      maxDays: 5,
    });
    await saveShippingMethod(tx, actor, null, { name: "Store pickup", priceMinor: 0, regions: ["LA"] });

    // Variant ids for orders
    const variants = await tx.execute<{ id: string; product_id: string; title: string }>(
      sql`SELECT id, product_id, title FROM product_variants WHERE store_id = ${storeId} AND deleted_at IS NULL`,
    );
    const pick = (productId: string, title?: string) =>
      variants.rows.find((r) => r.product_id === productId && (!title || r.title === title))!.id;

    const people = [
      { name: "Chioma Okafor", email: "chioma@example.com", phone: "08031234567", city: "Ikeja", state: "Lagos" },
      { name: "Tunde Bakare", email: "tunde@example.com", phone: "08029876543", city: "Ibadan", state: "Oyo" },
      { name: "Amina Yusuf", email: "amina@example.com", phone: "08051112222", city: "Abuja", state: "FCT" },
      { name: "Emeka Nwosu", email: "emeka@example.com", phone: "08064443333", city: "Enugu", state: "Enugu" },
    ];
    const addr = (p: (typeof people)[number]) => ({
      fullName: p.name,
      phone: p.phone,
      line1: "12 Allen Avenue",
      city: p.city,
      state: p.state,
      country: "NG",
    });

    const plan: { who: number; items: [string, number][]; ship: string; to: ("paid" | "shipped" | "delivered" | "cancelled")[]; daysAgo: number }[] = [
      { who: 0, items: [[pick(dress.id, "M / Blue"), 1], [pick(necklace.id), 1]], ship: lagos.id, to: ["paid", "shipped", "delivered"], daysAgo: 21 },
      { who: 1, items: [[pick(shirt.id, "L"), 2]], ship: nationwide.id, to: ["paid", "shipped"], daysAgo: 9 },
      { who: 2, items: [[pick(dress.id, "S / Orange"), 1]], ship: nationwide.id, to: ["paid"], daysAgo: 3 },
      { who: 3, items: [[pick(shirt.id, "XL"), 1]], ship: nationwide.id, to: [], daysAgo: 1 },
      { who: 0, items: [[pick(necklace.id), 1]], ship: lagos.id, to: ["cancelled"], daysAgo: 12 },
      { who: 2, items: [[pick(dress.id, "M / Orange"), 3], [pick(shirt.id, "M"), 3]], ship: nationwide.id, to: ["paid"], daysAgo: 0 },
    ];
    for (const o of plan) {
      const p = people[o.who];
      const order = await createOrder(tx, storeId, {
        email: p.email,
        name: p.name,
        phone: p.phone,
        items: o.items.map(([variantId, quantity]) => ({ variantId, quantity })),
        shippingMethodId: o.ship,
        shippingAddress: addr(p),
      });
      for (const to of o.to) await changeOrderStatus(tx, actor, order.id, { to, trackingNumber: to === "shipped" ? "GIG-48213" : undefined });
      const at = new Date(Date.now() - o.daysAgo * 86_400_000);
      await tx.update(orders).set({ createdAt: at }).where(eq(orders.id, order.id));
    }
    return true;
  });
}
