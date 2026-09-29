import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { rateLimit } from "../../security/rate-limit";
import { DomainError } from "../_shared/errors";
import { clientIp, requestBasePath, requestStoreId } from "./context";

export type ShopActionState<T = undefined> =
  | { ok: true; message?: string; data?: T; redirectTo?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }
  | null;

type Ctx = { storeId: string; base: string; ip: string };

/**
 * Wrapper for storefront server actions:
 *  - the store comes from the proxy-set request header, never from the client
 *  - optional per-IP rate limit
 *  - validation / business errors become form errors; anything else is logged
 */
export async function runShopAction<T>(
  opts: { limit?: { key: string; max: number; windowMs: number } },
  fn: (ctx: Ctx) => Promise<T>,
): Promise<ShopActionState<T>> {
  try {
    const ctx: Ctx = { storeId: await requestStoreId(), base: await requestBasePath(), ip: await clientIp() };
    if (opts.limit) {
      const rl = rateLimit(`${opts.limit.key}:${ctx.storeId}:${ctx.ip}`, opts.limit.max, opts.limit.windowMs);
      if (!rl.ok) return { ok: false, error: `Too many attempts. Please try again in ${rl.retryAfterSec} seconds.` };
    }
    return { ok: true, data: await fn(ctx) };
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof z.ZodError) {
      return { ok: false, error: "Please check the highlighted fields.", fieldErrors: z.flattenError(err).fieldErrors as Record<string, string[]> };
    }
    if (err instanceof DomainError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    console.error("[shop action] unexpected error", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
