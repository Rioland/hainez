import "server-only";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireStoreRole, type StoreContext } from "../../auth/guards";
import type { StoreRole } from "../../auth/memberships";
import type { StoreActor } from "./actor";
import { DomainError } from "./errors";

/**
 * What every dashboard form action returns (consumed by useActionState).
 *
 * Actions never call redirect(): with our proxy rewrites, Next.js 16.3's
 * single-roundtrip action redirect re-fetched the target page without the
 * session cookie and bounced users to login. Actions return `redirectTo` and
 * the client navigates (see useActionRedirect).
 */
export type ActionState<T = undefined> =
  | { ok: true; message?: string; data?: T; redirectTo?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }
  | null;

export type StoreActionContext = StoreContext & { actor: StoreActor };

type Options = {
  /** Minimum store role. Default "staff". */
  min?: StoreRole;
  /** Mutations are refused while the dashboard is read-only (billing lapsed, suspended). Default true. */
  write?: boolean;
};

async function clientInfo() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  return { ip: ip && /^[0-9a-f:.]+$/i.test(ip) ? ip : null, userAgent: h.get("user-agent") };
}

/**
 * Standard wrapper for store dashboard server actions:
 *  1. re-authenticates and checks membership + role for THIS store (never trust
 *     the client: server actions are plain POST endpoints),
 *  2. refuses writes when the dashboard is read-only,
 *  3. turns validation/business errors into form errors, logs anything else.
 */
export async function runStoreAction<T>(
  subdomain: string,
  opts: Options,
  fn: (ctx: StoreActionContext) => Promise<T>,
): Promise<ActionState<T>> {
  try {
    const ctx = await requireStoreRole(subdomain, opts.min ?? "staff");
    if ((opts.write ?? true) && ctx.access.dashboard === "read_only") {
      return { ok: false, error: "Your store is read-only right now. Renew your subscription to make changes." };
    }
    const { ip, userAgent } = await clientInfo();
    const actor: StoreActor = {
      storeId: ctx.store.storeId,
      userId: ctx.session.user.id,
      role: ctx.role,
      impersonatorId: (ctx.session.session as { impersonatedBy?: string | null }).impersonatedBy ?? null,
      ip,
      userAgent,
    };
    const data = await fn({ ...ctx, actor });
    return { ok: true, data };
  } catch (err) {
    unstable_rethrow(err); // redirect(), notFound() etc. must propagate
    if (err instanceof z.ZodError) {
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: z.flattenError(err).fieldErrors as Record<string, string[]> };
    }
    if (err instanceof DomainError) {
      return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    }
    const pg = (err as { cause?: { code?: string } })?.cause ?? (err as { code?: string });
    if (pg?.code === "23505") return { ok: false, error: "That value is already in use. Please choose another." };
    console.error("[action] unexpected error", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
