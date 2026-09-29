import type { Metadata } from "next";
import { Container } from "@/components/ui";
import { PageLinks, pageNumber, parseSort, SortLinks } from "@/components/storefront/listing";
import { ProductGrid } from "@/components/storefront/product-card";
import { getPublicStore, listPublicProducts } from "@/server/modules/storefront/catalog";
import { requestBasePath } from "@/server/modules/storefront/context";

export async function generateMetadata({ searchParams }: PageProps<"/s/[storeId]/search">): Promise<Metadata> {
  const q = (await searchParams).q;
  // Search result pages shouldn't be indexed; the product and category pages are.
  return { title: typeof q === "string" && q ? `Search: ${q}` : "All products", robots: { index: false, follow: true } };
}

export default async function SearchPage({ params, searchParams }: PageProps<"/s/[storeId]/search">) {
  const { storeId } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const sort = parseSort(sp.sort);
  const page = pageNumber(sp.page);
  const [store, base, list] = await Promise.all([
    getPublicStore(storeId),
    requestBasePath(),
    listPublicProducts(storeId, { q: q || undefined, sort, page }),
  ]);
  const path = `${base}/search`;

  return (
    <Container className="py-10">
      <h1 className="text-3xl font-semibold">{q ? `Results for “${q}”` : "All products"}</h1>
      <form action={path} className="mt-4 flex max-w-lg gap-2">
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search products"
          aria-label="Search products"
          className="flex-1 rounded-full border border-border px-4 py-2 text-sm outline-none focus:border-brand"
        />
        <button className="rounded-full bg-brand px-5 py-2 text-sm font-medium text-brand-foreground">Search</button>
      </form>
      <div className="my-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{list.total} products</p>
        <SortLinks path={path} sort={sort} keep={{ q: q || undefined }} />
      </div>
      {list.rows.length === 0 ? (
        <p className="py-16 text-center text-muted">{q ? "No products match your search." : "No products yet."}</p>
      ) : (
        <ProductGrid products={list.rows} base={base} currency={store!.currency} />
      )}
      <PageLinks path={path} page={list.page} pageCount={list.pageCount} keep={{ q: q || undefined, sort: sort === "newest" ? undefined : sort }} />
    </Container>
  );
}
