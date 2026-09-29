import "server-only";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { slugify, SLUG_RE } from "@/lib/slug";
import { categories, productCategories } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { subquery } from "../../db/sql";
import { audit } from "../audit/audit";
import type { StoreActor } from "../_shared/actor";
import { DomainError, NotFoundError } from "../_shared/errors";

/*
 * Categories. Every function takes a TenantTx, so it can only ever touch the
 * current store's rows (RLS); explicit store_id filters are kept for clarity.
 */

export const categoryInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(SLUG_RE, "Use lowercase letters, numbers and hyphens")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  description: z.string().trim().max(2000).optional(),
  parentId: z.uuid().nullable().optional(),
  position: z.coerce.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.input<typeof categoryInput>;

export async function listCategories(tx: TenantTx, storeId: string) {
  const rows = await tx
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      parentId: categories.parentId,
      position: categories.position,
      isActive: categories.isActive,
      description: categories.description,
      productCount: subquery<number>(sql`
        SELECT count(*)::int FROM ${productCategories}
        WHERE ${productCategories.storeId} = ${categories.storeId} AND ${productCategories.categoryId} = ${categories.id}`),
    })
    .from(categories)
    .where(eq(categories.storeId, storeId))
    .orderBy(asc(categories.position), asc(categories.name));
  return sortAsTree(rows);
}

/** Parents first, each followed by its children (depth-first), with a depth for indentation. */
export function sortAsTree<T extends { id: string; parentId: string | null }>(rows: T[]): (T & { depth: number })[] {
  const byParent = new Map<string | null, T[]>();
  for (const r of rows) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
  const out: (T & { depth: number })[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const r of byParent.get(parent) ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ ...r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  // Orphans (parent filtered out) still appear.
  for (const r of rows) if (!seen.has(r.id)) out.push({ ...r, depth: 0 });
  return out;
}

async function uniqueSlug(tx: TenantTx, storeId: string, base: string, excludeId?: string) {
  const root = base || "category";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const [hit] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(eq(categories.storeId, storeId), eq(categories.slug, candidate), excludeId ? ne(categories.id, excludeId) : undefined),
      )
      .limit(1);
    if (!hit) return candidate;
  }
  throw new DomainError("Couldn't find a free slug; please enter one.");
}

/** A category can't be its own ancestor. */
async function assertNoCycle(tx: TenantTx, storeId: string, id: string, parentId: string | null | undefined) {
  let current = parentId ?? null;
  for (let depth = 0; current && depth < 20; depth++) {
    if (current === id) throw new DomainError("A category can't be inside itself.", { parentId: ["Choose a different parent"] });
    const [row] = await tx
      .select({ parentId: categories.parentId })
      .from(categories)
      .where(and(eq(categories.storeId, storeId), eq(categories.id, current)));
    if (!row) throw new DomainError("Parent category not found.", { parentId: ["Not found"] });
    current = row.parentId;
  }
}

export async function createCategory(tx: TenantTx, actor: StoreActor, raw: CategoryInput) {
  const input = categoryInput.parse(raw);
  if (input.parentId) await assertNoCycle(tx, actor.storeId, "00000000-0000-0000-0000-000000000000", input.parentId);
  if (input.slug) await assertSlugFree(tx, actor.storeId, input.slug);
  const slug = input.slug ?? (await uniqueSlug(tx, actor.storeId, slugify(input.name)));
  const [row] = await tx
    .insert(categories)
    .values({ ...input, parentId: input.parentId ?? null, slug, storeId: actor.storeId })
    .returning({ id: categories.id });
  await audit(tx, actor, { action: "category.create", entityType: "category", entityId: row.id, changes: { name: input.name } });
  return row;
}

async function assertSlugFree(tx: TenantTx, storeId: string, slug: string, excludeId?: string) {
  const [hit] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.storeId, storeId), eq(categories.slug, slug), excludeId ? ne(categories.id, excludeId) : undefined));
  if (hit) throw new DomainError("That URL slug is already used.", { slug: ["Already used by another category"] });
}

export async function updateCategory(tx: TenantTx, actor: StoreActor, id: string, raw: CategoryInput) {
  const input = categoryInput.parse(raw);
  const [existing] = await tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.storeId, actor.storeId), eq(categories.id, id)));
  if (!existing) throw new NotFoundError("Category");
  await assertNoCycle(tx, actor.storeId, id, input.parentId);
  const slug = input.slug ?? (await uniqueSlug(tx, actor.storeId, slugify(input.name), id));
  if (input.slug) await assertSlugFree(tx, actor.storeId, input.slug, id);
  await tx
    .update(categories)
    .set({ ...input, parentId: input.parentId ?? null, slug })
    .where(and(eq(categories.storeId, actor.storeId), eq(categories.id, id)));
  await audit(tx, actor, { action: "category.update", entityType: "category", entityId: id, changes: { name: [existing.name, input.name] } });
}

/** Deleting a category keeps its products; child categories move up to the top level (FK SET NULL). */
export async function deleteCategory(tx: TenantTx, actor: StoreActor, id: string) {
  const deleted = await tx
    .delete(categories)
    .where(and(eq(categories.storeId, actor.storeId), eq(categories.id, id)))
    .returning({ name: categories.name });
  if (deleted.length === 0) throw new NotFoundError("Category");
  await audit(tx, actor, { action: "category.delete", entityType: "category", entityId: id, changes: { name: deleted[0].name } });
}

export async function countCategories(tx: TenantTx, storeId: string) {
  const [{ n }] = await tx.select({ n: count() }).from(categories).where(eq(categories.storeId, storeId));
  return n;
}
