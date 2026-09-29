import { describe, expect, it, vi } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";
import { getStoreAccess } from "@/server/tenancy/access";
import { createCachedResolver } from "@/server/tenancy/resolver-cache";
import type { ResolvedStore } from "@/server/tenancy/routing";
import { checkSubdomain } from "@/server/tenancy/subdomain";

describe("checkSubdomain", () => {
  it("accepts and normalises valid names", () => {
    expect(checkSubdomain("  Mama-Put ")).toEqual({ ok: true, value: "mama-put" });
    expect(checkSubdomain("shop123")).toEqual({ ok: true, value: "shop123" });
  });
  it("rejects reserved words", () => {
    for (const name of ["www", "admin", "app", "api", "mail", "cdn"]) {
      expect(checkSubdomain(name)).toEqual({ ok: false, reason: "reserved" });
    }
    expect(checkSubdomain("vip", ["vip"])).toEqual({ ok: false, reason: "reserved" });
  });
  it("rejects bad shapes", () => {
    expect(checkSubdomain("ab")).toMatchObject({ reason: "too_short" });
    expect(checkSubdomain("a".repeat(64))).toMatchObject({ reason: "too_long" });
    expect(checkSubdomain("-shop")).toMatchObject({ reason: "invalid_characters" });
    expect(checkSubdomain("shop-")).toMatchObject({ reason: "invalid_characters" });
    expect(checkSubdomain("my_shop")).toMatchObject({ reason: "invalid_characters" });
    expect(checkSubdomain("my.shop")).toMatchObject({ reason: "invalid_characters" });
    expect(checkSubdomain("xn--80ak6aa92e")).toMatchObject({ reason: "double_hyphen" });
  });
});

describe("getStoreAccess", () => {
  it("keeps trialing, active and grace-period stores open", () => {
    expect(getStoreAccess({ billingStatus: "trialing", adminSuspended: false })).toEqual({ storefront: "open", dashboard: "full", notice: null });
    expect(getStoreAccess({ billingStatus: "active", adminSuspended: false }).storefront).toBe("open");
    expect(getStoreAccess({ billingStatus: "past_due", adminSuspended: false })).toMatchObject({ storefront: "open", notice: "grace_period" });
  });
  it("closes suspended/cancelled stores and makes the dashboard read-only", () => {
    expect(getStoreAccess({ billingStatus: "suspended", adminSuspended: false })).toEqual({ storefront: "closed", dashboard: "read_only", notice: "billing_suspended" });
    expect(getStoreAccess({ billingStatus: "cancelled", adminSuspended: false })).toMatchObject({ storefront: "closed", dashboard: "read_only" });
  });
  it("admin suspension wins over billing", () => {
    expect(getStoreAccess({ billingStatus: "active", adminSuspended: true })).toMatchObject({ storefront: "closed", notice: "admin_suspended" });
  });
});

describe("createCachedResolver", () => {
  const store: ResolvedStore = { id: "s1", subdomain: "demo", primaryHost: null, matchedHostname: null, storefrontOpen: true };

  it("caches hits and misses, and invalidates per store", async () => {
    const bySubdomain = vi.fn(async (sub: string) => (sub === "demo" ? store : null));
    const byHostname = vi.fn(async () => null);
    const r = createCachedResolver({ bySubdomain, byHostname });

    await r.bySubdomain("demo");
    await r.bySubdomain("demo");
    expect(bySubdomain).toHaveBeenCalledTimes(1);

    await r.bySubdomain("nope");
    await r.bySubdomain("nope");
    expect(bySubdomain).toHaveBeenCalledTimes(2); // negative result cached too

    r.invalidate("s1");
    await r.bySubdomain("demo");
    expect(bySubdomain).toHaveBeenCalledTimes(3);
  });

  it("expires negative results sooner than hits", async () => {
    let clock = 1_000_000;
    const loader = vi.fn(async (sub: string) => (sub === "demo" ? store : null));
    const r = createCachedResolver(
      { bySubdomain: loader, byHostname: loader },
      { ttlMs: 60_000, negativeTtlMs: 1_000, now: () => clock },
    );
    await r.bySubdomain("new-store");
    await r.bySubdomain("demo");
    clock += 1_500; // past the negative TTL, well within the positive TTL
    await r.bySubdomain("new-store");
    await r.bySubdomain("demo");
    expect(loader.mock.calls.map((c) => c[0])).toEqual(["new-store", "demo", "new-store"]);
  });
});

describe("safeNextPath", () => {
  it("allows same-site paths only", () => {
    expect(safeNextPath("/dashboard/demo", "/")).toBe("/dashboard/demo");
    expect(safeNextPath("https://evil.com", "/")).toBe("/");
    expect(safeNextPath("//evil.com", "/")).toBe("/");
    expect(safeNextPath("/\\evil.com", "/")).toBe("/");
    expect(safeNextPath(undefined, "/x")).toBe("/x");
  });
});
