import Link from "next/link";
import { Container } from "@/components/ui";
import { ProductGrid } from "@/components/storefront/product-card";
import { getPublicStore, listPublicCategories, listPublicProducts } from "@/server/modules/storefront/catalog";
import { requestBasePath } from "@/server/modules/storefront/context";

// Home page. Stage 4 makes the hero (image, headline, button) configurable per store.
export default async function StorefrontHome({ params }: PageProps<"/s/[storeId]">) {
  const { storeId } = await params;
  const [store, base, categories, featured, latest] = await Promise.all([
    getPublicStore(storeId),
    requestBasePath(),
    listPublicCategories(storeId),
    listPublicProducts(storeId, { featured: true, limit: 8 }),
    listPublicProducts(storeId, { sort: "newest", limit: 8 }),
  ]);
  const currency = store!.currency;
  const topLevel = categories.filter((c) => !c.parentId);

  return (
    <>
      <section className="bg-brand/10">
        <Container className="py-16 text-center sm:py-24">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{store!.name}</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted">{store!.seo.description ?? "Welcome! Browse our latest products below."}</p>
          <Link href={`${base}/search`} className="mt-6 inline-flex rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground hover:opacity-90">
            Shop now
          </Link>
        </Container>
      </section>

      {latest.total === 0 ? (
        <Container className="py-20 text-center text-muted">Products are coming soon. Check back shortly!</Container>
      ) : (
        <>
          {featured.rows.length > 0 && (
            <Container className="pt-14">
              <h2 className="mb-6 text-2xl font-semibold">Featured</h2>
              <ProductGrid products={featured.rows} base={base} currency={currency} />
            </Container>
          )}

          {topLevel.length > 0 && (
            <Container className="pt-14">
              <h2 className="mb-6 text-2xl font-semibold">Shop by category</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {topLevel.map((c) => (
                  <Link
                    key={c.id}
                    href={`${base}/c/${c.slug}`}
                    className="rounded-xl border border-border px-4 py-6 text-center font-medium hover:border-brand hover:bg-brand/5"
                  >
                    {c.name}
                  </Link>
                ))}
              </div>
            </Container>
          )}

          <Container className="pt-14">
            <div className="mb-6 flex items-end justify-between">
              <h2 className="text-2xl font-semibold">New arrivals</h2>
              <Link href={`${base}/search`} className="text-sm text-brand hover:underline">
                View all
              </Link>
            </div>
            <ProductGrid products={latest.rows} base={base} currency={currency} />
          </Container>
        </>
      )}
    </>
  );
}
