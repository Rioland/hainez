import { Container } from "@/components/ui";
import { getStorefrontStore } from "@/server/modules/storefront/store";

// Placeholder home page. Product grid, categories and search arrive in Stage 3.
export default async function StorefrontHome({ params }: PageProps<"/s/[storeId]">) {
  const store = (await getStorefrontStore((await params).storeId))!; // layout already 404s if missing
  return (
    <>
      <section className="bg-brand/10">
        <Container className="py-20 text-center">
          <h1 className="text-4xl font-bold tracking-tight">Welcome to {store.name}</h1>
          <p className="mt-3 text-muted">Our products are on their way. Check back soon!</p>
        </Container>
      </section>
      <Container className="py-12">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-xl border border-dashed border-border bg-slate-50" />
          ))}
        </div>
      </Container>
    </>
  );
}
