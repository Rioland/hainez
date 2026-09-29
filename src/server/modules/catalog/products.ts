import "server-only";
import { and, asc, desc, eq, exists, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { slugify, SLUG_RE } from "@/lib/slug";
import { MAX_OPTIONS, MAX_VALUES_PER_OPTION, MAX_VARIANTS, variantKey, variantTitle } from "@/lib/variants";
import { categories, media, productCategories, productImages, products, productVariants } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { audit } from "../audit/audit";
import { inSequence, subquery } from "../../db/sql";
import { mediaUrl } from "../media/uploads";
import type { StoreActor } from "../_shared/actor";
import { DomainError, NotFoundError } from "../_shared/errors";
import { pageParams, toPage } from "../_shared/pagination";

/* ----------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------- */

const MAX_MINOR = 100_000_000_000; // ₦1bn in kobo; sanity cap
const money = z.number({ error: "Enter a valid amount" }).int().min(0).max(MAX_MINOR);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const variantInput = z.object({
  id: z.uuid().optional(),
  optionValues: z.record(z.string(), z.string()),
  priceMinor: money,
  compareAtPriceMinor: money.nullable().optional(),
  sku: optionalText(64),
  stockQuantity: z.number().int().min(-100_000).max(1_000_000),
  trackInventory: z.boolean(),
  allowBackorder: z.boolean(),
  weightGrams: z.number().int().min(0).max(1_000_000).nullable().optional(),
});

export const productInput = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    slug: z
      .string()
      .trim()
      .max(80)
      .regex(SLUG_RE, "Use lowercase letters, numbers and hyphens")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    description: optionalText(20_000),
    status: z.enum(["draft", "active", "archived"]),
    isFeatured: z.boolean().default(false),
    seoTitle: optionalText(70),
    seoDescription: optionalText(320),
    categoryIds: z.array(z.uuid()).max(20).default([]),
    options: z
      .array(
        z.object({
          name: z.string().trim().min(1, "Option name is required").max(40),
          values: z.array(z.string().trim().min(1).max(60)).min(1, "Add at least one value").max(MAX_VALUES_PER_OPTION),
        }),
      )
      .max(MAX_OPTIONS, `At most ${MAX_OPTIONS} options`),
    variants: z.array(variantInput).min(1, "A product needs at least one variant").max(MAX_VARIANTS),
    images: z.array(z.object({ mediaId: z.uuid(), alt: optionalText(200) })).max(20).default([]),
  })
  .superRefine((p, ctx) => {
    const names = p.options.map((o) => o.name.toLowerCase());
    if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Option names must be different" });
    p.options.forEach((o, i) => {
      if (new Set(o.values.map((v) => v.toLowerCase())).size !== o.values.length) {
        ctx.addIssue({ code: "custom", path: ["options", i, "values"], message: `"${o.name}" has duplicate values` });
      }
    });
    const seen = new Set<string>();
    p.variants.forEach((v, i) => {
      const keys = Object.keys(v.optionValues);
      const shapeOk =
        keys.length === p.options.length &&
        p.options.every((o) => o.values.includes(v.optionValues[o.name] ?? "\u0000"));
      if (!shapeOk) ctx.addIssue({ code: "custom", path: ["variants", i], message: "Variant doesn't match the product options" });
      const key = variantKey(p.options, v.optionValues);
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["variants", i], message: "Duplicate variant" });
      seen.add(key);
      if (v.compareAtPriceMinor != null && v.compareAtPriceMinor <= v.priceMinor) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "compareAtPriceMinor"], message: "Compare-at price must be higher than the price" });
      }
      if (v.stockQuantity < 0 && !v.allowBackorder && v.trackInventory) {
        ctx.addIssue({ code: "custom", path: ["variants", i, "stockQuantity"], message: "Stock can't be negative" });
      }
    });
    const skus = p.variants.map((v) => v.sku?.toLowerCase()).filter(Boolean);
    if (new Set(skus).size !== skus.length) ctx.addIssue({ code: "custom", path: ["variants"], message: "SKUs must be unique" });
  });

export type ProductInput = z.input<typeof productInput>;

/* ----------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------- */

export type ProductListFilters = { q?: string; status?: string; categoryId?: string; page?: unknown };

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listProducts(tx: TenantTx, storeId: string, f: ProductListFilters) {
  const { page, limit, offset } = pageParams(f.page);
  const where: SQL[] = [eq(products.storeId, storeId), isNull(products.deletedAt)];
  if (f.status && ["draft", "active", "archived"].includes(f.status)) {
    where.push(eq(products.status, f.status as "draft" | "active" | "archived"));
  }
  if (f.categoryId && z.uuid().safeParse(f.categoryId).success) {
    where.push(
      exists(
        tx
          .select({ one: sql`1` })
          .from(productCategories)
          .where(and(eq(productCategories.productId, products.id), eq(productCategories.categoryId, f.categoryId))),
      ),
    );
  }
  const q = f.q?.trim();
  if (q) {
    const pattern = `%${likeEscape(q)}%`;
    where.push(
      or(
        ilike(products.title, pattern),
        exists(
          tx
            .select({ one: sql`1` })
            .from(productVariants)
            .where(and(eq(productVariants.productId, products.id), isNull(productVariants.deletedAt), ilike(productVariants.sku, pattern))),
        ),
      )!,
    );
  }

  const live = sql`${productVariants.productId} = ${products.id} AND ${productVariants.deletedAt} IS NULL`;
  const rows = await tx
    .select({
      id: products.id,
      title: products.title,
      slug: products.slug,
      status: products.status,
      updatedAt: products.updatedAt,
      variantCount: subquery<number>(sql`SELECT count(*)::int FROM ${productVariants} WHERE ${live}`),
      minPrice: subquery<number | null>(sql`SELECT min(${productVariants.priceMinor})::bigint FROM ${productVariants} WHERE ${live}`).mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
      maxPrice: subquery<number | null>(sql`SELECT max(${productVariants.priceMinor})::bigint FROM ${productVariants} WHERE ${live}`).mapWith(
        (v) => (v === null ? null : Number(v)),
      ),
      stock: subquery<number | null>(
        sql`SELECT sum(${productVariants.stockQuantity})::int FROM ${productVariants} WHERE ${live} AND ${productVariants.trackInventory}`,
      ),
      imageKey: subquery<string | null>(sql`
        SELECT ${media.storageKey} FROM ${productImages} JOIN ${media} ON ${media.id} = ${productImages.mediaId}
        WHERE ${productImages.productId} = ${products.id} ORDER BY ${productImages.position} LIMIT 1`),
      total: sql<number>`count(*) OVER ()`.mapWith(Number),
    })
    .from(products)
    .where(and(...where))
    .orderBy(desc(products.updatedAt))
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map(({ total: _total, imageKey, ...r }) => ({ ...r, imageUrl: imageKey ? mediaUrl(imageKey) : null })),
    rows[0]?.total ?? 0,
    page,
  );
}

export async function getProductForEdit(tx: TenantTx, storeId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.id, id), isNull(products.deletedAt)));
  if (!product) return null;

  const [cats, variants, images] = await inSequence(
    () =>
      tx
        .select({ categoryId: productCategories.categoryId })
        .from(productCategories)
        .where(and(eq(productCategories.storeId, storeId), eq(productCategories.productId, id))),
    () =>
      tx
        .select()
        .from(productVariants)
        .where(and(eq(productVariants.storeId, storeId), eq(productVariants.productId, id), isNull(productVariants.deletedAt)))
        .orderBy(asc(productVariants.position)),
    () =>
      tx
        .select({ mediaId: productImages.mediaId, alt: productImages.alt, storageKey: media.storageKey })
        .from(productImages)
        .innerJoin(media, and(eq(media.storeId, productImages.storeId), eq(media.id, productImages.mediaId)))
        .where(and(eq(productImages.storeId, storeId), eq(productImages.productId, id)))
        .orderBy(asc(productImages.position)),
  );

  return {
    ...product,
    categoryIds: cats.map((c) => c.categoryId),
    variants,
    images: images.map((i) => ({ mediaId: i.mediaId, alt: i.alt, url: mediaUrl(i.storageKey) })),
  };
}

/* ----------------------------------------------------------------------------
 * Mutations
 * ------------------------------------------------------------------------- */

async function slugTaken(tx: TenantTx, storeId: string, slug: string, excludeId?: string) {
  const [hit] = await tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(eq(products.storeId, storeId), eq(products.slug, slug), isNull(products.deletedAt), excludeId ? ne(products.id, excludeId) : undefined),
    )
    .limit(1);
  return Boolean(hit);
}

async function freeSlug(tx: TenantTx, storeId: string, base: string, excludeId?: string) {
  const root = base || "product";
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    if (!(await slugTaken(tx, storeId, candidate, excludeId))) return candidate;
  }
  throw new DomainError("Couldn't find a free URL for this product; please enter one.", { slug: ["Enter a slug"] });
}

/**
 * Create (id = null) or update a product with its categories, variants and
 * images, in the caller's tenant transaction. Removed variants are soft-deleted
 * so past orders keep their references.
 */
export async function saveProduct(tx: TenantTx, actor: StoreActor, id: string | null, raw: ProductInput) {
  const input = productInput.parse(raw);
  const storeId = actor.storeId;

  let existing: typeof products.$inferSelect | undefined;
  if (id) {
    [existing] = await tx
      .select()
      .from(products)
      .where(and(eq(products.storeId, storeId), eq(products.id, id), isNull(products.deletedAt)));
    if (!existing) throw new NotFoundError("Product");
  }

  // URL slug: explicit slugs must be free; otherwise keep the current one (so links
  // don't break when the title changes) or derive a free one from the title.
  let slug: string;
  if (input.slug) {
    if (await slugTaken(tx, storeId, input.slug, id ?? undefined)) {
      throw new DomainError("That URL is already used by another product.", { slug: ["Already in use"] });
    }
    slug = input.slug;
  } else {
    slug = existing?.slug ?? (await freeSlug(tx, storeId, slugify(input.title)));
  }

  // Categories must exist in this store (RLS would hide others anyway).
  if (input.categoryIds.length) {
    const found = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.storeId, storeId), inArray(categories.id, input.categoryIds)));
    if (found.length !== new Set(input.categoryIds).size) throw new DomainError("One of the categories no longer exists.");
  }

  const values = {
    title: input.title,
    slug,
    description: input.description,
    status: input.status,
    isFeatured: input.isFeatured,
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    options: input.options,
    publishedAt: input.status === "active" ? (existing?.publishedAt ?? new Date()) : (existing?.publishedAt ?? null),
  };

  let productId: string;
  if (existing) {
    await tx.update(products).set(values).where(and(eq(products.storeId, storeId), eq(products.id, existing.id)));
    productId = existing.id;
  } else {
    const [row] = await tx.insert(products).values({ ...values, storeId }).returning({ id: products.id });
    productId = row.id;
  }

  // --- categories: replace
  await tx.delete(productCategories).where(and(eq(productCategories.storeId, storeId), eq(productCategories.productId, productId)));
  if (input.categoryIds.length) {
    await tx
      .insert(productCategories)
      .values([...new Set(input.categoryIds)].map((categoryId, position) => ({ storeId, productId, categoryId, position })));
  }

  // --- variants: update / insert / soft-delete
  const current = existing
    ? await tx
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(and(eq(productVariants.storeId, storeId), eq(productVariants.productId, productId), isNull(productVariants.deletedAt)))
    : [];
  const currentIds = new Set(current.map((v) => v.id));
  for (const v of input.variants) {
    if (v.id && !currentIds.has(v.id)) throw new DomainError("A variant was changed by someone else. Reload and try again.");
  }
  const keptIds = new Set(input.variants.map((v) => v.id).filter(Boolean) as string[]);
  const removed = [...currentIds].filter((vid) => !keptIds.has(vid));
  if (removed.length) {
    await tx
      .update(productVariants)
      .set({ deletedAt: new Date() })
      .where(and(eq(productVariants.storeId, storeId), inArray(productVariants.id, removed)));
  }
  // Two-phase update so swapping option values or SKUs between variants can't
  // trip the unique indexes mid-way.
  const kept = input.variants.filter((v) => v.id);
  for (const v of kept) {
    await tx
      .update(productVariants)
      .set({ optionValues: { __moving: v.id! }, sku: null })
      .where(and(eq(productVariants.storeId, storeId), eq(productVariants.id, v.id!)));
  }
  for (const [position, v] of input.variants.entries()) {
    const data = {
      title: variantTitle(input.options, v.optionValues),
      optionValues: input.options.length ? v.optionValues : {},
      priceMinor: v.priceMinor,
      compareAtPriceMinor: v.compareAtPriceMinor ?? null,
      sku: v.sku,
      stockQuantity: v.stockQuantity,
      trackInventory: v.trackInventory,
      allowBackorder: v.allowBackorder,
      weightGrams: v.weightGrams ?? null,
      position,
    };
    if (v.id) {
      await tx
        .update(productVariants)
        .set(data)
        .where(and(eq(productVariants.storeId, storeId), eq(productVariants.id, v.id)));
    } else {
      await tx.insert(productVariants).values({ ...data, storeId, productId });
    }
  }

  // --- images: replace (composite FK guarantees the media belongs to this store)
  await tx.delete(productImages).where(and(eq(productImages.storeId, storeId), eq(productImages.productId, productId)));
  if (input.images.length) {
    const ids = [...new Set(input.images.map((i) => i.mediaId))];
    const found = await tx.select({ id: media.id }).from(media).where(and(eq(media.storeId, storeId), inArray(media.id, ids)));
    if (found.length !== ids.length) throw new DomainError("One of the images no longer exists. Remove it and try again.");
    await tx
      .insert(productImages)
      .values(input.images.map((img, position) => ({ storeId, productId, mediaId: img.mediaId, alt: img.alt, position })));
  }

  await audit(tx, actor, {
    action: existing ? "product.update" : "product.create",
    entityType: "product",
    entityId: productId,
    changes: {
      title: existing && existing.title !== input.title ? [existing.title, input.title] : input.title,
      status: existing && existing.status !== input.status ? [existing.status, input.status] : input.status,
      variants: input.variants.length,
      removedVariants: removed.length,
    },
  });

  return { id: productId, slug };
}

/** Soft delete: hidden everywhere, but past orders still reference it. Frees its slug and SKUs. */
export async function deleteProduct(tx: TenantTx, actor: StoreActor, id: string) {
  const now = new Date();
  const [row] = await tx
    .update(products)
    .set({ deletedAt: now, status: "archived" })
    .where(and(eq(products.storeId, actor.storeId), eq(products.id, id), isNull(products.deletedAt)))
    .returning({ title: products.title });
  if (!row) throw new NotFoundError("Product");
  await tx
    .update(productVariants)
    .set({ deletedAt: now })
    .where(and(eq(productVariants.storeId, actor.storeId), eq(productVariants.productId, id), isNull(productVariants.deletedAt)));
  await tx.delete(productCategories).where(and(eq(productCategories.storeId, actor.storeId), eq(productCategories.productId, id)));
  await audit(tx, actor, { action: "product.delete", entityType: "product", entityId: id, changes: { title: row.title } });
}

export async function setProductStatus(tx: TenantTx, actor: StoreActor, id: string, status: "draft" | "active" | "archived") {
  const [row] = await tx
    .update(products)
    .set({ status, ...(status === "active" ? { publishedAt: sql`coalesce(${products.publishedAt}, now())` } : {}) })
    .where(and(eq(products.storeId, actor.storeId), eq(products.id, id), isNull(products.deletedAt)))
    .returning({ id: products.id });
  if (!row) throw new NotFoundError("Product");
  await audit(tx, actor, { action: "product.status", entityType: "product", entityId: id, changes: { status } });
}
