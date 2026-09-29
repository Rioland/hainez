import "server-only";
import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { availability } from "@/lib/availability";
import type { ProductOption } from "@/lib/variants";
import { categories, domains, media, productCategories, productImages, products, productVariants, stores } from "../../db/schema";
import { inSequence, subquery } from "../../db/sql";
import { withTenant } from "../../db/tenant";
import { storeTags } from "../catalog/cache";
import { mediaUrl } from "../media/uploads";

/*
 * Public (storefront) reads. Everything here is cached per store with
 * unstable_cache and tagged `store:{id}:catalog` / `store:{id}:settings`, which
 * dashboard actions expire with updateTag, so owners see their edits at once
 * and shoppers get cached pages the rest of the time.
 *
 * Cached values go through JSON: return plain data (ISO strings, not Dates).
 */

const HOUR = 3600;

function cached<T>(storeId: string, key: unknown[], tags: string[], fn: () => Promise<T>): Promise<T> {
  return unstable_cache(fn, ["storefront", storeId, ...key.map((k) => JSON.stringify(k ?? null))], {
    tags: [storeTags.store(storeId), ...tags],
    revalidate: HOUR,
  })();
}

/* ------------------------------------------------------------------ store */

export type PublicStore = {
  id: string;
  name: string;
  subdomain: string;
  currency: string;
  contactEmail: string | null;
  contactPhone: string | null;
  seo: { title?: string; description?: string };
  primaryHost: string | null;
};

export function getPublicStore(storeId: string): Promise<PublicStore | null> {
  return cached(storeId, ["store"], [storeTags.settings(storeId)], () =>
    withTenant(storeId, async (tx) => {
      const [s] = await tx
        .select({
          id: stores.id,
          name: stores.name,
          subdomain: stores.subdomain,
          currency: stores.currency,
          contactEmail: stores.contactEmail,
          contactPhone: stores.contactPhone,
          seo: stores.seo,
        })
        .from(stores)
        .where(eq(stores.id, storeId));
      if (!s) return null;
      const [primary] = await tx
        .select({ hostname: domains.hostname })
        .from(domains)
        .where(and(eq(domains.storeId, storeId), eq(domains.isPrimary, true), eq(domains.status, "active")));
      return { ...s, seo: (s.seo ?? {}) as PublicStore["seo"], primaryHost: primary?.hostname ?? null };
    }),
  );
}

/* ------------------------------------------------------------- categories */

export type PublicCategory = { id: string; name: string; slug: string; parentId: string | null; description: string | null };

export function listPublicCategories(storeId: string): Promise<PublicCategory[]> {
  return cached(storeId, ["categories"], [storeTags.catalog(storeId)], () =>
    withTenant(storeId, (tx) =>
      tx
        .select({ id: categories.id, name: categories.name, slug: categories.slug, parentId: categories.parentId, description: categories.description })
        .from(categories)
        .where(and(eq(categories.storeId, storeId), eq(categories.isActive, true)))
        .orderBy(asc(categories.position), asc(categories.name)),
    ),
  );
}

/* --------------------------------------------------------------- products */

export type ProductCard = {
  id: string;
  slug: string;
  title: string;
  minPrice: number;
  maxPrice: number;
  /** Highest "was" price among variants, if any is on sale. */
  compareAt: number | null;
  imageUrl: string | null;
  available: boolean;
};

export type ProductSort = "newest" | "price_asc" | "price_desc";
export const PRODUCTS_PER_PAGE = 24;

export type ProductQuery = {
  categorySlug?: string;
  q?: string;
  sort?: ProductSort;
  page?: number;
  featured?: boolean;
  limit?: number;
};

/** Live variants of a visible product. */
const liveVariant = sql`${productVariants.productId} = ${products.id} AND ${productVariants.deletedAt} IS NULL`;
const availableVariant = sql`${liveVariant} AND (NOT ${productVariants.trackInventory} OR ${productVariants.allowBackorder} OR ${productVariants.stockQuantity} > 0)`;

export function listPublicProducts(storeId: string, query: ProductQuery): Promise<{ rows: ProductCard[]; total: number; page: number; pageCount: number }> {
  const page = Math.max(1, Math.min(500, Math.floor(query.page ?? 1)));
  const limit = Math.min(PRODUCTS_PER_PAGE, query.limit ?? PRODUCTS_PER_PAGE);
  const q = query.q?.trim().slice(0, 100) || undefined;
  return cached(storeId, ["products", { ...query, q, page, limit }], [storeTags.catalog(storeId)], () =>
    withTenant(storeId, async (tx) => {
      const where: SQL[] = [
        eq(products.storeId, storeId),
        eq(products.status, "active"),
        isNull(products.deletedAt),
        sql`EXISTS (SELECT 1 FROM ${productVariants} WHERE ${liveVariant})`,
      ];
      if (query.featured) where.push(eq(products.isFeatured, true));
      if (query.categorySlug) {
        // The category and all of its active sub-categories.
        where.push(sql`EXISTS (
          WITH RECURSIVE tree AS (
            SELECT c.id FROM categories c
            WHERE c.store_id = ${storeId} AND c.slug = ${query.categorySlug} AND c.is_active
            UNION ALL
            SELECT c.id FROM categories c JOIN tree ON c.parent_id = tree.id
            WHERE c.store_id = ${storeId} AND c.is_active
          )
          SELECT 1 FROM ${productCategories}
          WHERE ${productCategories.productId} = ${products.id} AND ${productCategories.categoryId} IN (SELECT id FROM tree)
        )`);
      }
      if (q) {
        // Full-text (uses the products_search GIN index) or a plain substring match on the title.
        where.push(sql`(
          to_tsvector('simple', ${products.title} || ' ' || coalesce(${products.description}, '')) @@ websearch_to_tsquery('simple', ${q})
          OR ${products.title} ILIKE ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}
        )`);
      }

      const minPrice = subquery<number>(sql`SELECT min(${productVariants.priceMinor})::bigint FROM ${productVariants} WHERE ${liveVariant}`).mapWith(Number);
      const orderBy =
        query.sort === "price_asc"
          ? [asc(minPrice), desc(products.publishedAt)]
          : query.sort === "price_desc"
            ? [desc(minPrice), desc(products.publishedAt)]
            : [desc(products.publishedAt), desc(products.createdAt)];

      const rows = await tx
        .select({
          id: products.id,
          slug: products.slug,
          title: products.title,
          minPrice,
          maxPrice: subquery<number>(sql`SELECT max(${productVariants.priceMinor})::bigint FROM ${productVariants} WHERE ${liveVariant}`).mapWith(Number),
          compareAt: subquery<number | null>(sql`
            SELECT max(${productVariants.compareAtPriceMinor})::bigint FROM ${productVariants}
            WHERE ${liveVariant} AND ${productVariants.compareAtPriceMinor} > ${productVariants.priceMinor}`).mapWith((v) =>
            v === null ? null : Number(v),
          ),
          imageKey: subquery<string | null>(sql`
            SELECT ${media.storageKey} FROM ${productImages} JOIN ${media} ON ${media.id} = ${productImages.mediaId}
            WHERE ${productImages.productId} = ${products.id} ORDER BY ${productImages.position} LIMIT 1`),
          available: subquery<boolean>(sql`SELECT EXISTS (SELECT 1 FROM ${productVariants} WHERE ${availableVariant})`),
          total: sql<number>`count(*) OVER ()`.mapWith(Number),
        })
        .from(products)
        .where(and(...where))
        .orderBy(...orderBy)
        .limit(limit)
        .offset((page - 1) * limit);

      const total = rows[0]?.total ?? 0;
      return {
        rows: rows.map(({ total: _t, imageKey, ...r }) => ({ ...r, imageUrl: imageKey ? mediaUrl(imageKey) : null })),
        total,
        page,
        pageCount: Math.max(1, Math.ceil(total / limit)),
      };
    }),
  );
}

export type PublicVariant = {
  id: string;
  title: string;
  optionValues: Record<string, string>;
  price: number;
  compareAt: number | null;
  sku: string | null;
  available: boolean;
  maxQty: number;
  lowStock: boolean;
};

export type PublicProduct = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  options: ProductOption[];
  variants: PublicVariant[];
  images: { url: string; alt: string | null }[];
  categories: { name: string; slug: string }[];
  updatedAt: string;
};

export function getPublicProduct(storeId: string, slug: string): Promise<PublicProduct | null> {
  return cached(storeId, ["product", slug], [storeTags.catalog(storeId)], () =>
    withTenant(storeId, async (tx) => {
      const [p] = await tx
        .select()
        .from(products)
        .where(and(eq(products.storeId, storeId), eq(products.slug, slug), eq(products.status, "active"), isNull(products.deletedAt)));
      if (!p) return null;
      const [variants, images, cats] = await inSequence(
        () =>
          tx
            .select()
            .from(productVariants)
            .where(and(eq(productVariants.storeId, storeId), eq(productVariants.productId, p.id), isNull(productVariants.deletedAt)))
            .orderBy(asc(productVariants.position)),
        () =>
          tx
            .select({ key: media.storageKey, alt: productImages.alt })
            .from(productImages)
            .innerJoin(media, and(eq(media.storeId, productImages.storeId), eq(media.id, productImages.mediaId)))
            .where(and(eq(productImages.storeId, storeId), eq(productImages.productId, p.id)))
            .orderBy(asc(productImages.position)),
        () =>
          tx
            .select({ name: categories.name, slug: categories.slug })
            .from(productCategories)
            .innerJoin(categories, and(eq(categories.storeId, productCategories.storeId), eq(categories.id, productCategories.categoryId)))
            .where(and(eq(productCategories.storeId, storeId), eq(productCategories.productId, p.id), eq(categories.isActive, true)))
            .orderBy(asc(productCategories.position)),
      );
      if (variants.length === 0) return null;
      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        description: p.description,
        seoTitle: p.seoTitle,
        seoDescription: p.seoDescription,
        options: p.options,
        variants: variants.map((v) => {
          const a = availability(v);
          return {
            id: v.id,
            title: v.title,
            optionValues: v.optionValues,
            price: v.priceMinor,
            compareAt: v.compareAtPriceMinor !== null && v.compareAtPriceMinor > v.priceMinor ? v.compareAtPriceMinor : null,
            sku: v.sku,
            available: a.available,
            maxQty: a.maxQty,
            lowStock: a.low,
          };
        }),
        images: images.map((i) => ({ url: mediaUrl(i.key), alt: i.alt })),
        categories: cats,
        updatedAt: p.updatedAt.toISOString(),
      };
    }),
  );
}

/** URLs for sitemap.xml. */
export function getSitemapEntries(storeId: string) {
  return cached(storeId, ["sitemap"], [storeTags.catalog(storeId)], () =>
    withTenant(storeId, async (tx) => {
      const [prods, cats] = await inSequence(
        () =>
          tx
            .select({ slug: products.slug, updatedAt: products.updatedAt })
            .from(products)
            .where(and(eq(products.storeId, storeId), eq(products.status, "active"), isNull(products.deletedAt)))
            .orderBy(desc(products.updatedAt))
            .limit(5000),
        () =>
          tx
            .select({ slug: categories.slug, updatedAt: categories.updatedAt })
            .from(categories)
            .where(and(eq(categories.storeId, storeId), eq(categories.isActive, true))),
      );
      const iso = (r: { slug: string; updatedAt: Date }) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() });
      return { products: prods.map(iso), categories: cats.map(iso) };
    }),
  );
}
