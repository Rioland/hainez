import { NextResponse, type NextRequest } from "next/server";
import { storeResolver } from "@/server/tenancy/resolve";
import { decideRoute, TENANT_HEADERS } from "@/server/tenancy/routing";
import { routingConfig } from "@/server/tenancy/urls";

/**
 * Tenant resolution (Next.js 16 "proxy", formerly middleware; runs on Node.js).
 *
 * Reads the Host header, works out which surface/store the request is for, and
 * rewrites to the internal route tree:
 *   /platform/*       platform site + store-owner dashboard
 *   /superadmin/*     super-admin
 *   /s/{storeId}/*    storefront
 * All routing rules live in src/server/tenancy/routing.ts (unit-tested).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const decision = await decideRoute({
    host: request.headers.get("host"),
    pathname,
    search,
    cfg: routingConfig,
    resolver: storeResolver,
  });

  // Never trust tenant headers sent by the client.
  const headers = new Headers(request.headers);
  headers.delete(TENANT_HEADERS.storeId);
  headers.delete(TENANT_HEADERS.basePath);

  switch (decision.type) {
    case "next":
      return NextResponse.next({ request: { headers } });

    case "redirect":
      return NextResponse.redirect(decision.location, decision.status);

    case "rewrite": {
      for (const [k, v] of Object.entries(decision.headers)) headers.set(k, v);
      const url = request.nextUrl.clone();
      url.pathname = decision.pathname;
      return NextResponse.rewrite(url, { request: { headers }, status: decision.status });
    }

    case "not-found": {
      const url = request.nextUrl.clone();
      url.pathname = "/store-not-found";
      url.search = "";
      return NextResponse.rewrite(url, { request: { headers }, status: 404 });
    }
  }
}

export const config = {
  // Everything except Next's own assets and root-level static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
