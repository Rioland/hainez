import { getPublicStore, getSitemapEntries } from "@/server/modules/storefront/catalog";
import { storefrontUrl } from "@/server/tenancy/urls";

/*
 * Per-store sitemap: {store host}/sitemap.xml. URLs are absolute and point at
 * the store's canonical host (its primary custom domain once connected).
 */

// Next treats sitemap.xml routes as static by default; this one is per store.
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(_req: Request, ctx: RouteContext<"/s/[storeId]/sitemap.xml">) {
  const { storeId } = await ctx.params;
  const store = UUID_RE.test(storeId) ? await getPublicStore(storeId) : null;
  if (!store) return new Response("Not found", { status: 404 });
  const { products, categories } = await getSitemapEntries(storeId);
  const url = (path: string) => storefrontUrl(store.subdomain, path, store.primaryHost);

  const entries = [
    { loc: url("/"), lastmod: products[0]?.updatedAt },
    ...categories.map((c) => ({ loc: url(`/c/${c.slug}`), lastmod: c.updatedAt })),
    ...products.map((p) => ({ loc: url(`/p/${p.slug}`), lastmod: p.updatedAt })),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries.map((e) => `  <url><loc>${esc(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600" },
  });
}
