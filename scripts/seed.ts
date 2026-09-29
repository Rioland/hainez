/**
 * Seed the database.
 *
 *   pnpm db:seed          reserved subdomains, platform settings, super admin
 *   pnpm db:seed --demo   ...plus a demo owner and three demo stores (dev only)
 *
 * Idempotent: safe to run repeatedly. Super admin credentials come from
 * SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD (never hard-coded).
 */
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import * as schema from "../src/server/db/schema";
import { RESERVED_SUBDOMAINS } from "../src/server/tenancy/subdomain";

const { users, authAccounts, stores, storeMembers, domains, reservedSubdomains, platformSettings } = schema;

type Db = NodePgDatabase<typeof schema>;

async function ensureUser(db: Db, opts: { name: string; email: string; password: string; superAdmin?: boolean }) {
  const email = opts.email.toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) {
    if (opts.superAdmin) await db.update(users).set({ platformRole: "super_admin" }).where(eq(users.id, existing.id));
    return existing.id;
  }
  const [user] = await db
    .insert(users)
    .values({ name: opts.name, email, emailVerified: true, platformRole: opts.superAdmin ? "super_admin" : "user" })
    .returning({ id: users.id });
  // Same shape Better Auth writes for email+password accounts.
  await db.insert(authAccounts).values({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await hashPassword(opts.password),
  });
  return user.id;
}

async function ensureStore(
  db: Db,
  ownerId: string,
  s: { name: string; subdomain: string; billingStatus: "trialing" | "active" | "suspended"; contactEmail?: string },
) {
  const [existing] = await db.select({ id: stores.id }).from(stores).where(eq(stores.subdomain, s.subdomain));
  if (existing) return existing.id;
  const [store] = await db
    .insert(stores)
    .values({
      name: s.name,
      subdomain: s.subdomain,
      billingStatus: s.billingStatus,
      trialEndsAt: sql`now() + interval '30 days'`,
      contactEmail: s.contactEmail,
    })
    .returning({ id: stores.id });
  await db.insert(storeMembers).values({ storeId: store.id, userId: ownerId, role: "owner" });
  return store.id;
}

async function main() {
  const demo = process.argv.includes("--demo");
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (demo && process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");

  const client = new Client({ connectionString: url });
  await client.connect();
  const db = drizzle(client, { schema });

  try {
    await db
      .insert(reservedSubdomains)
      .values(RESERVED_SUBDOMAINS.map((name) => ({ name, reason: "platform" })))
      .onConflictDoNothing();
    console.log(`✓ ${RESERVED_SUBDOMAINS.length} reserved subdomains`);

    await db
      .insert(platformSettings)
      .values([
        { key: "billing", value: { trial_days: 30, grace_days: 7 } },
        { key: "domain_pricing", value: { markup_percent: 25, markup_fixed_minor: 500000, round_to_minor: 50000 } },
        { key: "fx_usd_ngn", value: { rate: null, source: "manual" } },
      ])
      .onConflictDoNothing();
    console.log("✓ platform settings");

    const adminEmail = process.env.SEED_SUPERADMIN_EMAIL;
    const adminPassword = process.env.SEED_SUPERADMIN_PASSWORD;
    if (adminEmail && adminPassword) {
      if (adminPassword.length < 12) throw new Error("SEED_SUPERADMIN_PASSWORD must be at least 12 characters");
      await ensureUser(db, { name: "Super Admin", email: adminEmail, password: adminPassword, superAdmin: true });
      console.log(`✓ super admin ${adminEmail}`);
    } else {
      console.log("• skipped super admin (set SEED_SUPERADMIN_EMAIL and SEED_SUPERADMIN_PASSWORD)");
    }

    if (demo) {
      const password = process.env.SEED_DEMO_PASSWORD ?? "demo-password-123";
      const ownerId = await ensureUser(db, { name: "Ada Demo", email: "owner@demo.test", password });
      await ensureStore(db, ownerId, { name: "Demo Store", subdomain: "demo", billingStatus: "trialing", contactEmail: "hello@demo.test" });
      const acmeId = await ensureStore(db, ownerId, { name: "Acme Fashion", subdomain: "acme", billingStatus: "active" });
      await ensureStore(db, ownerId, { name: "Closed Shop", subdomain: "closed", billingStatus: "suspended" });
      await db
        .insert(domains)
        .values({
          storeId: acmeId,
          hostname: "acme-fashion.test",
          kind: "external",
          status: "active",
          registrar: "external",
          isPrimary: true,
          verificationToken: "demo-token",
          verifiedAt: new Date(),
        })
        .onConflictDoNothing();
      const [demoStore] = await db.select({ id: stores.id }).from(stores).where(eq(stores.subdomain, "demo"));
      // A staff member (can manage products/orders, not settings) to try role limits.
      const staffId = await ensureUser(db, { name: "Sam Staff", email: "staff@demo.test", password });
      await db.insert(storeMembers).values({ storeId: demoStore.id, userId: staffId, role: "staff" }).onConflictDoNothing();
      const { seedDemoCatalog } = await import("./seed-demo-catalog");
      if (await seedDemoCatalog(demoStore.id, ownerId)) console.log("✓ demo catalog: categories, 5 products, delivery options, 6 orders");
      else console.log("• demo catalog already present");
      const { pool } = await import("../src/server/db/platform");
      await pool.end();
      console.log(`✓ demo owner owner@demo.test / ${password} (staff: staff@demo.test, same password)`);
      console.log("✓ demo stores: demo (trialing), acme (active, custom domain acme-fashion.test), closed (suspended)");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
