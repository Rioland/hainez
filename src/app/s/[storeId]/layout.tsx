import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { getCurrentCart } from "@/server/modules/storefront/cart";
import { getPublicStore, listPublicCategories } from "@/server/modules/storefront/catalog";
import { requestBasePath } from "@/server/modules/storefront/context";
import { getCurrentCustomer } from "@/server/modules/storefront/customer-auth";
import { storefrontUrl } from "@/server/tenancy/urls";

/*
 * Storefront shell. Every store host (subdomain, custom domain, or /store/{name}
 * in path mode) is rewritten here by the proxy as /s/{storeId}/...
 * Links are prefixed with the base path so both routing modes work.
 * Stage 4 injects the store's theme (colours, fonts, logo) on this wrapper.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadStore(storeId: string) {
  if (!UUID_RE.test(storeId)) notFound();
  const store = await getPublicStore(storeId);
  if (!store) notFound();
  return store;
}

export async function generateMetadata({ params }: LayoutProps<"/s/[storeId]">): Promise<Metadata> {
  const store = await loadStore((await params).storeId);
  const home = storefrontUrl(store.subdomain, "/", store.primaryHost);
  const description = store.seo.description ?? `Shop online at ${store.name}.`;
  return {
    metadataBase: new URL(home),
    title: { default: store.seo.title ?? store.name, template: `%s · ${store.name}` },
    description,
    openGraph: { siteName: store.name, title: store.seo.title ?? store.name, description, type: "website", url: home },
    twitter: { card: "summary_large_image" },
  };
}

export default async function StorefrontLayout({ children, params }: LayoutProps<"/s/[storeId]">) {
  const { storeId } = await params;
  const store = await loadStore(storeId);
  const [base, categories, cart, customer] = await Promise.all([
    requestBasePath(),
    listPublicCategories(storeId),
    getCurrentCart(storeId),
    getCurrentCustomer(storeId),
  ]);
  const topLevel = categories.filter((c) => !c.parentId).slice(0, 6);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-white">
      <header className="sticky top-0 z-20 border-b border-border bg-white/95 backdrop-blur">
        <Container className="flex h-16 items-center gap-4">
          <Link href={base || "/"} className="shrink-0 text-lg font-semibold tracking-tight">
            {store.name}
          </Link>
          <form action={`${base}/search`} className="hidden flex-1 md:block">
            <input
              name="q"
              type="search"
              placeholder="Search products"
              aria-label="Search products"
              className="w-full max-w-md rounded-full border border-border bg-slate-50 px-4 py-2 text-sm outline-none focus:border-brand focus:bg-white"
            />
          </form>
          <nav className="ml-auto flex items-center gap-4 text-sm">
            <Link href={`${base}/search`} className="md:hidden" aria-label="Search">
              Search
            </Link>
            <Link href={customer ? `${base}/account` : `${base}/account/login`} className="hover:underline">
              {customer ? "Account" : "Sign in"}
            </Link>
            <Link href={`${base}/cart`} className="relative rounded-full bg-brand px-3 py-1.5 font-medium text-brand-foreground">
              Cart{cart.itemCount > 0 && <span className="ml-1">({cart.itemCount})</span>}
            </Link>
          </nav>
        </Container>
        {topLevel.length > 0 && (
          <Container className="flex gap-5 overflow-x-auto pb-2 text-sm text-muted">
            <Link href={`${base}/search`} className="shrink-0 hover:text-foreground">
              All products
            </Link>
            {topLevel.map((c) => (
              <Link key={c.id} href={`${base}/c/${c.slug}`} className="shrink-0 hover:text-foreground">
                {c.name}
              </Link>
            ))}
          </Container>
        )}
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="mt-16 border-t border-border bg-slate-50">
        <Container className="grid gap-6 py-10 text-sm sm:grid-cols-3">
          <div>
            <p className="font-semibold">{store.name}</p>
            {store.contactEmail && <p className="mt-1 text-muted">{store.contactEmail}</p>}
            {store.contactPhone && <p className="text-muted">{store.contactPhone}</p>}
          </div>
          <div className="space-y-1">
            <p className="font-medium">Shop</p>
            {topLevel.slice(0, 4).map((c) => (
              <Link key={c.id} href={`${base}/c/${c.slug}`} className="block text-muted hover:text-foreground">
                {c.name}
              </Link>
            ))}
          </div>
          <div className="space-y-1">
            <p className="font-medium">Help</p>
            <Link href={`${base}/account`} className="block text-muted hover:text-foreground">
              Your orders
            </Link>
            <Link href={`${base}/cart`} className="block text-muted hover:text-foreground">
              Cart
            </Link>
          </div>
        </Container>
        <p className="pb-6 text-center text-xs text-muted">© {new Date().getFullYear()} {store.name}</p>
      </footer>
    </div>
  );
}
