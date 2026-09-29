import "server-only";
import { headers } from "next/headers";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { getStoreAccess, type StoreAccess } from "../tenancy/access";
import { href } from "../tenancy/request";
import { auth } from "./auth";
import { findMembership, roleAtLeast, type StoreRole } from "./memberships";

/**
 * Current platform session (deduplicated per request). Fails closed: if auth
 * can't evaluate the request (e.g. an unexpected Host), treat it as signed out
 * rather than erroring the page.
 */
export const getSession = cache(async () => {
  // Read headers outside the try: this is what marks the route as dynamic.
  const requestHeaders = await headers();
  try {
    return await auth.api.getSession({ headers: requestHeaders });
  } catch (err) {
    unstable_rethrow(err); // never swallow Next.js control-flow errors
    console.error("[auth] getSession failed; treating request as signed out:", err);
    return null;
  }
});

/** Require a signed-in platform user, otherwise redirect to this surface's login page. */
export async function requireUser(returnTo?: string) {
  const session = await getSession();
  if (!session) {
    const login = await href("/login");
    redirect(returnTo ? `${login}?next=${encodeURIComponent(returnTo)}` : login);
  }
  return session;
}

/** Super admins only. Everyone else gets a plain 404 (don't advertise the surface). */
export async function requireSuperAdmin() {
  const session = await requireUser();
  if (session.user.platformRole !== "super_admin") notFound();
  return session;
}

export type StoreContext = {
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
  store: NonNullable<Awaited<ReturnType<typeof findMembership>>>;
  role: StoreRole;
  access: StoreAccess;
};

/**
 * Require the signed-in user to be a member of the store with at least `min`
 * role. Returns the store id to pass to withTenant() for all further queries.
 * Non-members get a 404 so store subdomains can't be probed via the dashboard.
 */
export async function requireStoreRole(subdomain: string, min: StoreRole = "staff"): Promise<StoreContext> {
  const session = await requireUser(`/dashboard/${subdomain}`);
  const store = await findMembership(subdomain, session.user.id);
  if (!store || !roleAtLeast(store.role, min)) notFound();
  const access = getStoreAccess({
    billingStatus: store.billingStatus,
    adminSuspended: store.adminSuspendedAt !== null,
  });
  return { session, store, role: store.role, access };
}
