import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformDb, pool } from "@/server/db/platform";
import { domains, stores } from "@/server/db/schema";
import { loadStoreByHostname, loadStoreBySubdomain } from "@/server/tenancy/resolve";

let openId: string;
let closedId: string;

beforeAll(async () => {
  const trialEndsAt = new Date(Date.now() + 864e5);
  const rows = await platformDb
    .insert(stores)
    .values([
      { name: "Resolve Open", subdomain: "res-open", trialEndsAt, billingStatus: "active" },
      { name: "Resolve Closed", subdomain: "res-closed", trialEndsAt, billingStatus: "suspended" },
      { name: "Resolve Admin", subdomain: "res-admin", trialEndsAt, adminSuspendedAt: new Date() },
      { name: "Resolve Deleted", subdomain: "res-deleted", trialEndsAt, deletedAt: new Date() },
    ])
    .returning({ id: stores.id, subdomain: stores.subdomain });
  openId = rows.find((r) => r.subdomain === "res-open")!.id;
  closedId = rows.find((r) => r.subdomain === "res-closed")!.id;

  const base = { kind: "external" as const, registrar: "external" as const, verificationToken: "t" };
  await platformDb.insert(domains).values([
    { ...base, storeId: openId, hostname: "open-shop.test", status: "active", isPrimary: true, includeWww: true },
    { ...base, storeId: openId, hostname: "second.test", status: "active", includeWww: false },
    { ...base, storeId: openId, hostname: "pending.test", status: "dns_pending" },
    { ...base, storeId: closedId, hostname: "removed.test", status: "removed" },
  ]);
});

afterAll(async () => {
  await pool.end();
});

describe("loadStoreBySubdomain", () => {
  it("returns the store with its primary custom domain", async () => {
    expect(await loadStoreBySubdomain("res-open")).toEqual({
      id: openId,
      subdomain: "res-open",
      primaryHost: "open-shop.test",
      matchedHostname: null,
      storefrontOpen: true,
    });
  });

  it("marks billing-suspended and admin-suspended stores as closed", async () => {
    expect((await loadStoreBySubdomain("res-closed"))?.storefrontOpen).toBe(false);
    expect((await loadStoreBySubdomain("res-admin"))?.storefrontOpen).toBe(false);
  });

  it("ignores deleted and unknown stores", async () => {
    expect(await loadStoreBySubdomain("res-deleted")).toBeNull();
    expect(await loadStoreBySubdomain("does-not-exist")).toBeNull();
  });
});

describe("loadStoreByHostname", () => {
  it("matches active custom domains exactly", async () => {
    expect(await loadStoreByHostname("open-shop.test")).toMatchObject({ id: openId, matchedHostname: "open-shop.test" });
    expect(await loadStoreByHostname("second.test")).toMatchObject({ id: openId, primaryHost: "open-shop.test" });
  });

  it("matches www only when the domain opted in", async () => {
    expect(await loadStoreByHostname("www.open-shop.test")).toMatchObject({ id: openId, matchedHostname: "open-shop.test" });
    expect(await loadStoreByHostname("www.second.test")).toBeNull();
  });

  it("does not route domains that aren't active", async () => {
    expect(await loadStoreByHostname("pending.test")).toBeNull();
    expect(await loadStoreByHostname("removed.test")).toBeNull();
  });

  it("stops routing when a domain is removed", async () => {
    await platformDb.update(domains).set({ status: "removed" }).where(eq(domains.hostname, "second.test"));
    expect(await loadStoreByHostname("second.test")).toBeNull();
  });
});
