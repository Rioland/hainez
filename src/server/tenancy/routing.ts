/**
 * Host + path -> route decision. Pure functions (no Next.js, no DB) so the whole
 * routing table is unit-testable; proxy.ts just executes the decision.
 *
 * Two modes (env ROUTING_MODE):
 *
 *  subdomain (needs a real domain, e.g. ROOT_DOMAIN=yourbrand.com)
 *    yourbrand.com, www.*        -> 308 to app.yourbrand.com
 *    app.yourbrand.com/*         -> /platform/*      (marketing, auth, dashboard)
 *    admin.yourbrand.com/*       -> /superadmin/*
 *    {store}.yourbrand.com/*     -> /s/{storeId}/*
 *    any other host              -> custom domain lookup -> /s/{storeId}/*
 *
 *  path (single host, e.g. your-project.vercel.app, until a domain is bought)
 *    /admin/*                    -> /superadmin/*
 *    /store/{store}/*            -> /s/{storeId}/*
 *    everything else             -> /platform/*
 *    any other host              -> custom domain lookup (works once domains are attached)
 */

export type RoutingMode = "subdomain" | "path";

export type RoutingConfig = {
  mode: RoutingMode;
  /** Platform host incl. port in dev, lowercase: "localhost:3000", "yourbrand.com". */
  rootDomain: string;
  useHttps: boolean;
  /** 301 store traffic to the store's primary custom domain. */
  enforceCanonicalHost: boolean;
};

/** What the proxy needs to know about a store. Produced by tenancy/resolve.ts. */
export type ResolvedStore = {
  id: string;
  subdomain: string;
  /** Active primary custom domain, if any (all other hosts redirect there). */
  primaryHost: string | null;
  /** Hostname row that matched a custom-domain lookup (apex when reached via www). */
  matchedHostname: string | null;
  storefrontOpen: boolean;
};

export type StoreResolver = {
  bySubdomain(subdomain: string): Promise<ResolvedStore | null>;
  byHostname(hostname: string): Promise<ResolvedStore | null>;
};

export type RouteDecision =
  | { type: "next" }
  | { type: "rewrite"; pathname: string; headers: Record<string, string>; status?: number }
  | { type: "redirect"; location: string; status: 301 | 308 }
  | { type: "not-found"; reason: string };

/** Internal route prefixes. Only reachable through a rewrite, never directly. */
export const INTERNAL_PREFIXES = ["/platform", "/superadmin", "/s", "/store-not-found"] as const;

/** Headers the proxy sets for downstream code. Client-sent copies are stripped. */
export const TENANT_HEADERS = {
  storeId: "x-store-id",
  basePath: "x-base-path",
} as const;

const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/;
const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  // "example.com." and "example.com.:443" are the same host as "example.com".
  host = host.replace(/\.(?=:\d+$)|\.$/, "");
  if (!host || host.length > 260 || !HOST_RE.test(host)) return null;
  return host;
}

export function stripPort(host: string): string {
  return host.replace(/:\d+$/, "");
}

export function isInternalPath(pathname: string): boolean {
  return INTERNAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type HostTarget =
  | { kind: "apex" }
  | { kind: "platform" }
  | { kind: "superadmin" }
  | { kind: "path-routing" }
  | { kind: "store-subdomain"; subdomain: string }
  | { kind: "custom-domain"; hostname: string }
  | { kind: "invalid" };

function isPathModePlatformHost(host: string, root: string): boolean {
  const bare = stripPort(host);
  return (
    host === root ||
    bare === stripPort(root) ||
    bare === "localhost" ||
    bare === "127.0.0.1" ||
    // Vercel production + preview deployments of this project
    bare.endsWith(".vercel.app")
  );
}

export function classifyHost(host: string, cfg: RoutingConfig): HostTarget {
  const root = cfg.rootDomain;

  if (cfg.mode === "path") {
    return isPathModePlatformHost(host, root)
      ? { kind: "path-routing" }
      : { kind: "custom-domain", hostname: stripPort(host) };
  }

  if (host === root || host === `www.${root}`) return { kind: "apex" };

  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1));
    if (label.includes(".")) return { kind: "invalid" }; // a.b.root: not something we serve
    if (label === "app") return { kind: "platform" };
    if (label === "admin") return { kind: "superadmin" };
    if (!SUBDOMAIN_RE.test(label)) return { kind: "invalid" };
    return { kind: "store-subdomain", subdomain: label };
  }

  return { kind: "custom-domain", hostname: stripPort(host) };
}

export type RouteInput = {
  host: string | null | undefined;
  pathname: string;
  /** Includes the leading "?" when present, e.g. "?q=shoes". */
  search: string;
  cfg: RoutingConfig;
  resolver: StoreResolver;
};

export async function decideRoute({ host: rawHost, pathname, search, cfg, resolver }: RouteInput): Promise<RouteDecision> {
  const host = normalizeHost(rawHost);
  if (!host) return { type: "not-found", reason: "invalid_host" };

  // Internal prefixes are only reachable via rewrite.
  if (isInternalPath(pathname)) return { type: "not-found", reason: "internal_path" };

  const target = classifyHost(host, cfg);
  const proto = cfg.useHttps ? "https" : "http";

  // --- Platform-owned hosts -------------------------------------------------
  const platformRewrite = (prefix: "/platform" | "/superadmin", rest: string, basePath: string): RouteDecision => {
    if (rest === "/api" || rest.startsWith("/api/")) return { type: "next" }; // route handlers
    return {
      type: "rewrite",
      pathname: rest === "/" ? prefix : `${prefix}${rest}`,
      headers: { [TENANT_HEADERS.basePath]: basePath },
    };
  };

  switch (target.kind) {
    case "invalid":
      return { type: "not-found", reason: "invalid_host" };

    case "apex":
      return { type: "redirect", location: `${proto}://app.${cfg.rootDomain}${pathname}${search}`, status: 308 };

    case "platform":
      return platformRewrite("/platform", pathname, "");

    case "superadmin":
      return platformRewrite("/superadmin", pathname, "");

    case "path-routing": {
      if (pathname === "/admin" || pathname.startsWith("/admin/")) {
        return platformRewrite("/superadmin", pathname.slice("/admin".length) || "/", "/admin");
      }
      const m = /^\/store\/([^/]+)(\/.*)?$/.exec(pathname);
      if (m) {
        const subdomain = decodeURIComponent(m[1]).toLowerCase();
        if (!SUBDOMAIN_RE.test(subdomain)) return { type: "not-found", reason: "store_not_found" };
        const store = await resolver.bySubdomain(subdomain);
        return storeDecision({ store, rest: m[2] || "/", basePath: `/store/${subdomain}`, host, search, cfg });
      }
      return platformRewrite("/platform", pathname, "");
    }

    case "store-subdomain": {
      const store = await resolver.bySubdomain(target.subdomain);
      return storeDecision({ store, rest: pathname, basePath: "", host, search, cfg });
    }

    case "custom-domain": {
      const store = await resolver.byHostname(target.hostname);
      return storeDecision({ store, rest: pathname, basePath: "", host, search, cfg });
    }
  }
}

function storeDecision(args: {
  store: ResolvedStore | null;
  rest: string;
  basePath: string;
  host: string;
  search: string;
  cfg: RoutingConfig;
}): RouteDecision {
  const { store, rest, basePath, host, search, cfg } = args;
  if (!store) return { type: "not-found", reason: "store_not_found" };

  // Platform auth and other platform APIs are never served on store hosts.
  if (rest === "/api" || rest.startsWith("/api/")) return { type: "not-found", reason: "api_on_store_host" };

  // One canonical host per store: good for SEO and keeps customer sessions on one host.
  const canonical = store.primaryHost ?? store.matchedHostname;
  if (cfg.enforceCanonicalHost && canonical && stripPort(host) !== canonical) {
    return { type: "redirect", location: `https://${canonical}${rest}${search}`, status: 301 };
  }

  const headers = { [TENANT_HEADERS.storeId]: store.id, [TENANT_HEADERS.basePath]: basePath };

  if (!store.storefrontOpen) {
    return { type: "rewrite", pathname: `/s/${store.id}/unavailable`, headers, status: 503 };
  }

  return { type: "rewrite", pathname: rest === "/" ? `/s/${store.id}` : `/s/${store.id}${rest}`, headers };
}
