import { describe, expect, it } from "vitest";
import {
  classifyHost,
  decideRoute,
  normalizeHost,
  type ResolvedStore,
  type RoutingConfig,
  type StoreResolver,
} from "@/server/tenancy/routing";

const DEMO: ResolvedStore = { id: "11111111-1111-7111-8111-111111111111", subdomain: "demo", primaryHost: null, matchedHostname: null, storefrontOpen: true };
const ACME: ResolvedStore = { id: "22222222-2222-7222-8222-222222222222", subdomain: "acme", primaryHost: "acme-fashion.com", matchedHostname: null, storefrontOpen: true };
const CLOSED: ResolvedStore = { id: "33333333-3333-7333-8333-333333333333", subdomain: "closed", primaryHost: null, matchedHostname: null, storefrontOpen: false };

const resolver: StoreResolver = {
  async bySubdomain(sub) {
    return { demo: DEMO, acme: ACME, closed: CLOSED }[sub] ?? null;
  },
  async byHostname(host) {
    if (host === "acme-fashion.com") return { ...ACME, matchedHostname: "acme-fashion.com" };
    if (host === "www.acme-fashion.com") return { ...ACME, matchedHostname: "acme-fashion.com" };
    if (host === "shop.other.ng") return { ...DEMO, matchedHostname: "shop.other.ng" };
    return null;
  },
};

const SUB: RoutingConfig = { mode: "subdomain", rootDomain: "hainez.com", useHttps: true, enforceCanonicalHost: true };
const PATH: RoutingConfig = { mode: "path", rootDomain: "hainez.vercel.app", useHttps: true, enforceCanonicalHost: true };

const route = (host: string | null, pathname: string, cfg = SUB, search = "") =>
  decideRoute({ host, pathname, search, cfg, resolver });

describe("normalizeHost", () => {
  it("lowercases and strips trailing dots", () => {
    expect(normalizeHost("Demo.Hainez.COM")).toBe("demo.hainez.com");
    expect(normalizeHost("demo.hainez.com.")).toBe("demo.hainez.com");
    expect(normalizeHost("demo.localhost:3000")).toBe("demo.localhost:3000");
  });
  it("rejects junk", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("evil.com/path")).toBeNull();
    expect(normalizeHost("a b.com")).toBeNull();
  });
});

describe("classifyHost (subdomain mode)", () => {
  it("recognises platform hosts", () => {
    expect(classifyHost("hainez.com", SUB)).toEqual({ kind: "apex" });
    expect(classifyHost("www.hainez.com", SUB)).toEqual({ kind: "apex" });
    expect(classifyHost("app.hainez.com", SUB)).toEqual({ kind: "platform" });
    expect(classifyHost("admin.hainez.com", SUB)).toEqual({ kind: "superadmin" });
  });
  it("treats other hosts as stores or custom domains", () => {
    expect(classifyHost("demo.hainez.com", SUB)).toEqual({ kind: "store-subdomain", subdomain: "demo" });
    expect(classifyHost("shop.acme.ng", SUB)).toEqual({ kind: "custom-domain", hostname: "shop.acme.ng" });
    expect(classifyHost("a.b.hainez.com", SUB)).toEqual({ kind: "invalid" });
    expect(classifyHost("-bad.hainez.com", SUB)).toEqual({ kind: "invalid" });
  });
  it("works with a port in dev", () => {
    const dev = { ...SUB, rootDomain: "localhost:3000" };
    expect(classifyHost("app.localhost:3000", dev)).toEqual({ kind: "platform" });
    expect(classifyHost("demo.localhost:3000", dev)).toEqual({ kind: "store-subdomain", subdomain: "demo" });
  });
});

describe("decideRoute: subdomain mode", () => {
  it("redirects the apex and www to the app host", async () => {
    expect(await route("hainez.com", "/pricing", SUB, "?a=1")).toEqual({
      type: "redirect",
      location: "https://app.hainez.com/pricing?a=1",
      status: 308,
    });
    expect((await route("www.hainez.com", "/")).type).toBe("redirect");
  });

  it("rewrites the app host to /platform and lets /api through", async () => {
    expect(await route("app.hainez.com", "/")).toMatchObject({ type: "rewrite", pathname: "/platform" });
    expect(await route("app.hainez.com", "/dashboard/demo")).toMatchObject({
      type: "rewrite",
      pathname: "/platform/dashboard/demo",
      headers: { "x-base-path": "" },
    });
    expect(await route("app.hainez.com", "/api/auth/get-session")).toEqual({ type: "next" });
  });

  it("rewrites the admin host to /superadmin", async () => {
    expect(await route("admin.hainez.com", "/")).toMatchObject({ type: "rewrite", pathname: "/superadmin" });
    expect(await route("admin.hainez.com", "/login")).toMatchObject({ type: "rewrite", pathname: "/superadmin/login" });
  });

  it("rewrites a store subdomain to /s/{id} with tenant headers", async () => {
    expect(await route("demo.hainez.com", "/")).toEqual({
      type: "rewrite",
      pathname: `/s/${DEMO.id}`,
      headers: { "x-store-id": DEMO.id, "x-base-path": "" },
    });
    expect(await route("demo.hainez.com", "/p/red-shoe")).toMatchObject({ pathname: `/s/${DEMO.id}/p/red-shoe` });
  });

  it("404s unknown stores, invalid hosts and missing hosts", async () => {
    expect(await route("nope.hainez.com", "/")).toMatchObject({ type: "not-found", reason: "store_not_found" });
    expect(await route("unknown-domain.com", "/")).toMatchObject({ type: "not-found", reason: "store_not_found" });
    expect(await route("a.b.hainez.com", "/")).toMatchObject({ type: "not-found" });
    expect(await route(null, "/")).toMatchObject({ type: "not-found", reason: "invalid_host" });
  });

  it("never exposes internal route prefixes directly", async () => {
    for (const p of ["/s", `/s/${DEMO.id}`, "/platform", "/platform/dashboard", "/superadmin", "/store-not-found"]) {
      expect(await route("app.hainez.com", p)).toMatchObject({ type: "not-found", reason: "internal_path" });
      expect(await route("demo.hainez.com", p)).toMatchObject({ type: "not-found", reason: "internal_path" });
    }
    // ...but similar-looking public paths are fine
    expect(await route("demo.hainez.com", "/shop")).toMatchObject({ type: "rewrite", pathname: `/s/${DEMO.id}/shop` });
    expect(await route("app.hainez.com", "/support")).toMatchObject({ type: "rewrite", pathname: "/platform/support" });
  });

  it("does not serve platform APIs (auth) on store hosts", async () => {
    expect(await route("demo.hainez.com", "/api/auth/sign-in/email")).toMatchObject({
      type: "not-found",
      reason: "api_on_store_host",
    });
    expect(await route("shop.other.ng", "/api/auth/get-session")).toMatchObject({ type: "not-found" });
  });

  it("serves the unavailable page with 503 for closed stores", async () => {
    expect(await route("closed.hainez.com", "/any/page")).toMatchObject({
      type: "rewrite",
      pathname: `/s/${CLOSED.id}/unavailable`,
      status: 503,
    });
  });

  it("301s to the store's primary custom domain", async () => {
    expect(await route("acme.hainez.com", "/p/dress", SUB, "?size=m")).toEqual({
      type: "redirect",
      location: "https://acme-fashion.com/p/dress?size=m",
      status: 301,
    });
    // No redirect when canonical enforcement is off (local dev)
    expect(await route("acme.hainez.com", "/", { ...SUB, enforceCanonicalHost: false })).toMatchObject({
      type: "rewrite",
      pathname: `/s/${ACME.id}`,
    });
  });

  it("resolves custom domains and redirects www to the apex", async () => {
    expect(await route("acme-fashion.com", "/")).toMatchObject({ type: "rewrite", pathname: `/s/${ACME.id}` });
    expect(await route("www.acme-fashion.com", "/cart")).toEqual({
      type: "redirect",
      location: "https://acme-fashion.com/cart",
      status: 301,
    });
    expect(await route("Shop.Other.NG.", "/")).toMatchObject({ type: "rewrite", pathname: `/s/${DEMO.id}` });
  });
});

describe("decideRoute: path mode (e.g. *.vercel.app before a domain is bought)", () => {
  it("routes the platform at the root", async () => {
    expect(await route("hainez.vercel.app", "/", PATH)).toMatchObject({ type: "rewrite", pathname: "/platform" });
    expect(await route("hainez.vercel.app", "/dashboard", PATH)).toMatchObject({ pathname: "/platform/dashboard" });
    expect(await route("hainez.vercel.app", "/api/auth/get-session", PATH)).toEqual({ type: "next" });
  });

  it("routes /admin to the super-admin with a base path", async () => {
    expect(await route("hainez.vercel.app", "/admin", PATH)).toMatchObject({
      pathname: "/superadmin",
      headers: { "x-base-path": "/admin" },
    });
    expect(await route("hainez.vercel.app", "/admin/login", PATH)).toMatchObject({ pathname: "/superadmin/login" });
    // "/administrator" is a platform page, not the admin
    expect(await route("hainez.vercel.app", "/administrator", PATH)).toMatchObject({ pathname: "/platform/administrator" });
  });

  it("routes /store/{name} to the storefront with a base path", async () => {
    expect(await route("hainez.vercel.app", "/store/demo", PATH)).toEqual({
      type: "rewrite",
      pathname: `/s/${DEMO.id}`,
      headers: { "x-store-id": DEMO.id, "x-base-path": "/store/demo" },
    });
    expect(await route("hainez.vercel.app", "/store/DEMO/p/x", PATH)).toMatchObject({ pathname: `/s/${DEMO.id}/p/x` });
    expect(await route("hainez.vercel.app", "/store/nope", PATH)).toMatchObject({ type: "not-found" });
    expect(await route("hainez.vercel.app", "/store/demo/api/x", PATH)).toMatchObject({ type: "not-found" });
    expect(await route("hainez.vercel.app", "/store/closed", PATH)).toMatchObject({ status: 503 });
  });

  it("treats Vercel preview URLs and localhost as the platform host", async () => {
    expect(await route("hainez-git-feat-rioland.vercel.app", "/store/demo", PATH)).toMatchObject({
      pathname: `/s/${DEMO.id}`,
    });
    expect(await route("localhost:3000", "/admin", PATH)).toMatchObject({ pathname: "/superadmin" });
  });

  it("still resolves attached custom domains", async () => {
    expect(await route("acme-fashion.com", "/", PATH)).toMatchObject({ pathname: `/s/${ACME.id}` });
  });
});
