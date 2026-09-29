import { getPublicStore } from "@/server/modules/storefront/catalog";
import { requestBasePath } from "@/server/modules/storefront/context";
import { storefrontUrl } from "@/server/tenancy/urls";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** {store host}/robots.txt: index the catalog, skip cart/checkout/account pages. */
export async function GET(_req: Request, ctx: RouteContext<"/s/[storeId]/robots.txt">) {
  const { storeId } = await ctx.params;
  const store = UUID_RE.test(storeId) ? await getPublicStore(storeId) : null;
  if (!store) return new Response("Not found", { status: 404 });
  const base = await requestBasePath();
  const lines = [
    "User-agent: *",
    ...["cart", "checkout", "account", "order", "search"].map((p) => `Disallow: ${base}/${p}`),
    "",
    `Sitemap: ${storefrontUrl(store.subdomain, "/sitemap.xml", store.primaryHost)}`,
    "",
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
