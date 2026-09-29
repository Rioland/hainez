import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { platformDb, pool } from "@/server/db/platform";
import { domains, storeMembers, stores, users } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";

/*
 * The core promise of the platform: a store can never read or modify another
 * store's data. These tests hit real Postgres with the real roles and policies.
 */

let storeA: string;
let storeB: string;
let domainB: string;

beforeAll(async () => {
  const [owner] = await platformDb
    .insert(users)
    .values({ name: "Owner", email: `owner-${Date.now()}@iso.test` })
    .returning({ id: users.id });
  const inserted = await platformDb
    .insert(stores)
    .values([
      { name: "Store A", subdomain: "iso-a", trialEndsAt: new Date(Date.now() + 864e5) },
      { name: "Store B", subdomain: "iso-b", trialEndsAt: new Date(Date.now() + 864e5) },
    ])
    .returning({ id: stores.id, subdomain: stores.subdomain });
  storeA = inserted.find((s) => s.subdomain === "iso-a")!.id;
  storeB = inserted.find((s) => s.subdomain === "iso-b")!.id;
  await platformDb.insert(storeMembers).values([
    { storeId: storeA, userId: owner.id, role: "owner" },
    { storeId: storeB, userId: owner.id, role: "owner" },
  ]);
  const ds = await platformDb
    .insert(domains)
    .values([
      { storeId: storeA, hostname: "iso-a.test", kind: "external", status: "active", registrar: "external", verificationToken: "a" },
      { storeId: storeB, hostname: "iso-b.test", kind: "external", status: "active", registrar: "external", verificationToken: "b" },
    ])
    .returning({ id: domains.id, storeId: domains.storeId });
  domainB = ds.find((d) => d.storeId === storeB)!.id;
});

afterAll(async () => {
  await pool.end();
});

/** Postgres error code of a failed promise (drizzle wraps pg errors in `cause`). */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? "unknown";
  }
  throw new Error("expected the query to fail");
}

describe("withTenant()", () => {
  it("only sees its own store row and its own child rows", async () => {
    await withTenant(storeA, async (tx) => {
      const visibleStores = await tx.select({ id: stores.id }).from(stores);
      expect(visibleStores).toEqual([{ id: storeA }]);

      const visibleDomains = await tx.select({ storeId: domains.storeId }).from(domains);
      expect(visibleDomains.length).toBeGreaterThan(0);
      expect(visibleDomains.every((d) => d.storeId === storeA)).toBe(true);

      const members = await tx.select({ storeId: storeMembers.storeId }).from(storeMembers);
      expect(members.every((m) => m.storeId === storeA)).toBe(true);
    });
  });

  it("cannot read another store's rows even when asking for them by id", async () => {
    const rows = await withTenant(storeA, (tx) => tx.select().from(domains).where(eq(domains.id, domainB)));
    expect(rows).toEqual([]);
  });

  it("cannot insert rows for another store (RLS WITH CHECK)", async () => {
    const code = await pgError(
      withTenant(storeA, (tx) =>
        tx.insert(domains).values({
          storeId: storeB,
          hostname: "sneaky.test",
          kind: "external",
          status: "active",
          registrar: "external",
          verificationToken: "x",
        }),
      ),
    );
    expect(code).toBe("42501"); // insufficient_privilege: new row violates row-level security policy
  });

  it("cannot update or delete another store's rows", async () => {
    await withTenant(storeA, async (tx) => {
      const updated = await tx.update(domains).set({ lastError: "hacked" }).where(eq(domains.id, domainB)).returning();
      expect(updated).toEqual([]);
      const deleted = await tx.delete(domains).where(eq(domains.id, domainB)).returning();
      expect(deleted).toEqual([]);
    });
    const [b] = await platformDb.select().from(domains).where(eq(domains.id, domainB));
    expect(b.lastError).toBeNull();
  });

  it("cannot move its own rows to another store", async () => {
    const code = await pgError(
      withTenant(storeA, (tx) => tx.update(domains).set({ storeId: storeB }).where(eq(domains.storeId, storeA))),
    );
    expect(code).toBe("42501");
  });

  it("can edit its own settings but not its subdomain or billing state", async () => {
    await withTenant(storeA, (tx) => tx.update(stores).set({ name: "Store A renamed" }).where(eq(stores.id, storeA)));
    expect(await pgError(withTenant(storeA, (tx) => tx.update(stores).set({ subdomain: "taken" })))).toBe("42501");
    expect(await pgError(withTenant(storeA, (tx) => tx.update(stores).set({ billingStatus: "active" })))).toBe("42501");
    expect(
      await pgError(withTenant(storeA, (tx) => tx.update(stores).set({ adminSuspendedAt: null }))),
    ).toBe("42501");
  });

  it("has no access to platform tables", async () => {
    expect(await pgError(withTenant(storeA, (tx) => tx.select().from(users)))).toBe("42501");
  });

  it("sees nothing if the tenant setting is missing (fails closed)", async () => {
    const rows = await platformDb.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_tenant`);
      return tx.select().from(domains);
    });
    expect(rows).toEqual([]);
  });

  it("rejects malformed store ids before touching the database", async () => {
    await expect(withTenant("not-a-uuid", async () => 1)).rejects.toThrow(/invalid store id/);
    await expect(withTenant("' OR 1=1 --", async () => 1)).rejects.toThrow(/invalid store id/);
  });

  it("does not leak the role or tenant into the next query on the same connection", async () => {
    await withTenant(storeA, async () => undefined);
    // Pool size is small; run a burst so we very likely reuse that connection.
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        platformDb.execute<{ role: string; store: string | null }>(
          sql`SELECT current_user AS role, nullif(current_setting('app.store_id', true), '') AS store`,
        ),
      ),
    );
    for (const r of results) {
      expect(r.rows[0].role).not.toBe("app_tenant");
      expect(r.rows[0].store).toBeNull();
    }
  });
});

describe("platform connection", () => {
  it("sees every store (used only by allowlisted modules)", async () => {
    const rows = await platformDb.select({ id: stores.id }).from(stores);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(storeA);
    expect(ids).toContain(storeB);
  });
});

describe("schema guard", () => {
  it("every table with a store_id column has row-level security", async () => {
    await platformDb.execute(sql`SELECT app_assert_tenant_rls()`);
  });

  it("the guard catches a tenant table that forgot RLS", async () => {
    await platformDb.execute(sql`CREATE TABLE forgot_rls (id int, store_id uuid)`);
    try {
      await expect(platformDb.execute(sql`SELECT app_assert_tenant_rls()`)).rejects.toThrow();
    } finally {
      await platformDb.execute(sql`DROP TABLE forgot_rls`);
    }
  });

  it("ids are UUID v7 (time-ordered)", async () => {
    const r = await platformDb.execute<{ v: string }>(sql`SELECT uuid_generate_v7()::text AS v`);
    expect(r.rows[0].v[14]).toBe("7");
  });
});
