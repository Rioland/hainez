import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { getStorefrontStore } from "@/server/modules/storefront/store";
import { href } from "@/server/tenancy/request";

/*
 * Storefront shell. Every store host (subdomain, custom domain, or /store/{name}
 * in path mode) is rewritten here by the proxy as /s/{storeId}/...
 * Stage 4 injects the store's theme as CSS variables on this wrapper.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadStore(storeId: string) {
  if (!UUID_RE.test(storeId)) notFound();
  const store = await getStorefrontStore(storeId);
  if (!store) notFound();
  return store;
}

export async function generateMetadata({ params }: LayoutProps<"/s/[storeId]">): Promise<Metadata> {
  const store = await loadStore((await params).storeId);
  return {
    title: { default: store.name, template: `%s · ${store.name}` },
    openGraph: { siteName: store.name, title: store.name },
  };
}

export default async function StorefrontLayout({ children, params }: LayoutProps<"/s/[storeId]">) {
  const store = await loadStore((await params).storeId);
  const home = await href("/");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-white">
      <header className="border-b border-border">
        <Container className="flex h-16 items-center justify-between">
          <Link href={home} className="text-lg font-semibold">
            {store.name}
          </Link>
          <nav className="flex gap-4 text-sm text-muted">
            <span title="Stage 3">Shop</span>
            <span title="Stage 3">Cart (0)</span>
          </nav>
        </Container>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted">
        © {new Date().getFullYear()} {store.name}
        {store.contactEmail ? ` · ${store.contactEmail}` : ""}
      </footer>
    </div>
  );
}
