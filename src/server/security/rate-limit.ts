/**
 * Minimal fixed-window rate limiter, in process memory.
 *
 * Good enough for one server and a first line of defence on serverless (each
 * instance counts separately). Stage 10 swaps the store for Redis/Upstash so
 * limits are shared across instances; callers won't change.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  // Occasionally drop expired buckets so memory stays bounded.
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (b.count >= limit) return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  b.count++;
  return { ok: true };
}

/** For tests. */
export function resetRateLimits() {
  buckets.clear();
}
