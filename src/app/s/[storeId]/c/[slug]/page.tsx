import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { PageLinks, pageNumber, parseSort, SortLinks } from "@/components/storefront/listing";
import { ProductGrid } from "@/components/storefront/product-card";
import { getPublicStore, listPublicCategories, listPublicProducts } from "@/server/modules/storefront/catalog";
import { requestBasePath } from "@/server/modules/storefront/context";
import { storefrontUrl } from "@/server/tenancy/urls";

async function findCategory(storeId: string, slug: string) {
  const cats = await listPublicCategories(storeId);
  const category = cats.find((c) => c.slug === slug);
  return category ? { category, children: cats.filter((c) => c.parentId === category.id), all: cats } : null;
}

export async function generateMetadata({ params }: PageProps<"/s/[storeId]/c/[slug]">): Promise<Metadata> {
  const { storeId, slug } = await params;
  const [found, store] = await Promise.all([findCategory(storeId, slug), getPublicStore(storeId)]);
  if (!found || !store) return {};
  return {
    title: found.category.name,
    description: found.category.description ?? `Shop ${found.category.name} at ${store.name}.`,
    alternates: { canonical: storefrontUrl(store.subdomain, `/c/${slug}`, store.primaryHost) },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/s/[storeId]/c/[slug]">) {
  const { storeId, slug } = await params;
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const page = pageNumber(sp.page);
  const [found, store, base] = await Promise.all([findCategory(storeId, slug), getPublicStore(storeId), requestBasePath()]);
  if (!found) notFound();
  const list = await listPublicProducts(storeId, { categorySlug: slug, sort, page });
  const parent = found.category.parentId ? found.all.find((c) => c.id === found.category.parentId) : null;
  const path = `${base}/c/${slug}`;

  return (
    <Container className="py-10">
      <nav className="text-sm text-muted">
        <Link href={base || "/"} className="hover:underline">
          Home
        </Link>
        {parent && (
          <>
            {" / "}
            <Link href={`${base}/c/${parent.slug}`} className="hover:underline">
              {parent.name}
            </Link>
          </>
        )}
      </nav>
      <h1 className="mt-2 text-3xl font-semibold">{found.category.name}</h1>
      {found.category.description && <p className="mt-2 max-w-2xl text-muted">{found.category.description}</p>}
      {found.children.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {found.children.map((c) => (
            <Link key={c.id} href={`${base}/c/${c.slug}`} className="rounded-full border border-border px-3 py-1 text-sm hover:border-brand">
              {c.name}
            </Link>
          ))}
        </div>
      )}
      <div className="my-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{list.total} products</p>
        <SortLinks path={path} sort={sort} />
      </div>
      {list.rows.length === 0 ? (
        <p className="py-16 text-center text-muted">No products in this category yet.</p>
      ) : (
        <ProductGrid products={list.rows} base={base} currency={store!.currency} />
      )}
      <PageLinks path={path} page={list.page} pageCount={list.pageCount} keep={{ sort: sort === "newest" ? undefined : sort }} />
    </Container>
  );
}
