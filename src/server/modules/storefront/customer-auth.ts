import "server-only";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { carts, customers, customerSessions } from "../../db/schema";
import { withTenant, type TenantTx } from "../../db/tenant";
import { hashToken, randomToken } from "../../security/tokens";
import { DomainError } from "../_shared/errors";
import { CART_COOKIE } from "./cart";
import { clientIp, readCookie, storeCookieOptions } from "./context";

/*
 * Customer accounts are per store: the same email on two stores is two separate
 * accounts, with separate passwords. Sessions live in customer_sessions (token
 * hash only) and the cookie is scoped to the store's host (and path, in path
 * mode). Completely separate from platform (store owner) auth.
 */

export const CUSTOMER_COOKIE = "ms_customer";
const SESSION_DAYS = 30;

export type CurrentCustomer = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  accountCreatedAt: Date | null;
  emailVerifiedAt: Date | null;
};

export const registerInput = z.object({
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(8, "At least 8 characters").max(128),
  phone: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => v || null),
});

export const loginInput = z.object({
  email: z.email("Enter a valid email").transform((e) => e.toLowerCase()),
  password: z.string().min(1, "Enter your password").max(128),
});

/* ------------------------------------------------------------ DB level */

async function createSession(tx: TenantTx, storeId: string, customerId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomToken();
  await tx.insert(customerSessions).values({
    storeId,
    customerId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    ipAddress: meta.ip ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export async function registerCustomer(tx: TenantTx, storeId: string, raw: z.input<typeof registerInput>, meta = {}) {
  const input = registerInput.parse(raw);
  const [existing] = await tx
    .select({ id: customers.id, passwordHash: customers.passwordHash })
    .from(customers)
    .where(and(eq(customers.storeId, storeId), eq(customers.email, input.email)));
  if (existing?.passwordHash) {
    throw new DomainError("An account with this email already exists. Please log in.", { email: ["Already registered"] });
  }
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  let customerId: string;
  if (existing) {
    // A guest who ordered before: turn their record into an account. The email
    // isn't proven yet, so their guest orders stay hidden (orders.placedSignedIn)
    // and the name/phone the store already has are kept.
    await tx
      .update(customers)
      .set({
        passwordHash,
        accountCreatedAt: now,
        name: sql`coalesce(${customers.name}, ${input.name})`,
        phone: sql`coalesce(${customers.phone}, ${input.phone})`,
      })
      .where(eq(customers.id, existing.id));
    customerId = existing.id;
  } else {
    const [row] = await tx
      .insert(customers)
      .values({ storeId, email: input.email, name: input.name, phone: input.phone, passwordHash, accountCreatedAt: now })
      .returning({ id: customers.id });
    customerId = row.id;
  }
  return { customerId, token: await createSession(tx, storeId, customerId, meta) };
}

// A real scrypt hash of a random password, so a login for an unknown email
// costs the same time as a wrong password (no account enumeration by timing).
const dummyHash = hashPassword(randomToken());

export async function loginCustomer(tx: TenantTx, storeId: string, raw: z.input<typeof loginInput>, meta = {}) {
  const input = loginInput.parse(raw);
  const [c] = await tx
    .select({ id: customers.id, passwordHash: customers.passwordHash })
    .from(customers)
    .where(and(eq(customers.storeId, storeId), eq(customers.email, input.email)));
  const ok = await verifyPassword({ hash: c?.passwordHash ?? (await dummyHash), password: input.password });
  if (!c?.passwordHash || !ok) throw new DomainError("Incorrect email or password.");
  await tx.update(customers).set({ lastLoginAt: new Date() }).where(eq(customers.id, c.id));
  return { customerId: c.id, token: await createSession(tx, storeId, c.id, meta) };
}

export async function customerForToken(tx: TenantTx, storeId: string, token: string | undefined): Promise<CurrentCustomer | null> {
  if (!token) return null;
  const [row] = await tx
    .select({
      id: customers.id,
      email: customers.email,
      name: customers.name,
      phone: customers.phone,
      accountCreatedAt: customers.accountCreatedAt,
      emailVerifiedAt: customers.emailVerifiedAt,
    })
    .from(customerSessions)
    .innerJoin(customers, and(eq(customers.storeId, customerSessions.storeId), eq(customers.id, customerSessions.customerId)))
    .where(
      and(
        eq(customerSessions.storeId, storeId),
        eq(customerSessions.tokenHash, hashToken(token)),
        gt(customerSessions.expiresAt, sql`now()`),
        sql`${customers.passwordHash} IS NOT NULL`,
      ),
    );
  return row ?? null;
}

/* ------------------------------------------------------ request (cookie) level */

/** Signed-in customer for this request, or null (deduplicated per request). */
export const getCurrentCustomer = cache(async (storeId: string) => {
  const token = await readCookie(CUSTOMER_COOKIE);
  if (!token) return null;
  return withTenant(storeId, (tx) => customerForToken(tx, storeId, token));
});

async function requestMeta() {
  return { ip: await clientIp(), userAgent: (await headers()).get("user-agent") };
}

/** Server actions: sign in (or register), set the cookie, and attach the current cart. */
export async function startCustomerSession(storeId: string, mode: "login" | "register", raw: unknown) {
  const meta = await requestMeta();
  const cartToken = await readCookie(CART_COOKIE);
  const token = await withTenant(storeId, async (tx) => {
    const { customerId, token } =
      mode === "register"
        ? await registerCustomer(tx, storeId, raw as z.input<typeof registerInput>, meta)
        : await loginCustomer(tx, storeId, raw as z.input<typeof loginInput>, meta);
    if (cartToken) {
      await tx
        .update(carts)
        .set({ customerId })
        .where(and(eq(carts.storeId, storeId), eq(carts.tokenHash, hashToken(cartToken)), eq(carts.status, "active")));
    }
    return token;
  });
  (await cookies()).set(CUSTOMER_COOKIE, token, await storeCookieOptions(SESSION_DAYS * 86_400));
}

export async function endCustomerSession(storeId: string) {
  const token = await readCookie(CUSTOMER_COOKIE);
  if (token) {
    await withTenant(storeId, (tx) =>
      tx.delete(customerSessions).where(and(eq(customerSessions.storeId, storeId), eq(customerSessions.tokenHash, hashToken(token)))),
    );
  }
  (await cookies()).delete({ name: CUSTOMER_COOKIE, path: (await storeCookieOptions(0)).path });
}
