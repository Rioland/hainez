import { LRUCache } from "lru-cache";
import type { ResolvedStore, StoreResolver } from "./routing";

type Entry = { value: ResolvedStore | null };

export type CachedResolverOptions = {
  max?: number;
  /** TTL for found stores. */
  ttlMs?: number;
  /** Shorter TTL for "not found", so a new store/domain shows up quickly. */
  negativeTtlMs?: number;
  /** Clock override for tests. */
  now?: () => number;
};

/**
 * Wraps DB loaders with an LRU cache. Kept separate from resolve.ts (no DB
 * imports) so cache behaviour is unit-testable with fake loaders.
 */
export function createCachedResolver(
  loaders: StoreResolver,
  { max = 5000, ttlMs = 60_000, negativeTtlMs = 15_000, now }: CachedResolverOptions = {},
) {
  const cache = new LRUCache<string, Entry>({
    max,
    ttl: ttlMs,
    ...(now ? { perf: { now }, ttlResolution: 0 } : {}),
  });
  // Remember which keys point at a store so invalidate(storeId) can drop them all.
  const keysByStore = new Map<string, Set<string>>();

  async function get(key: string, load: () => Promise<ResolvedStore | null>): Promise<ResolvedStore | null> {
    const hit = cache.get(key);
    if (hit) return hit.value;
    const value = await load();
    cache.set(key, { value }, { ttl: value ? ttlMs : negativeTtlMs });
    if (value) {
      const keys = keysByStore.get(value.id) ?? new Set<string>();
      keys.add(key);
      keysByStore.set(value.id, keys);
    }
    return value;
  }

  return {
    bySubdomain: (subdomain: string) => get(`sub:${subdomain}`, () => loaders.bySubdomain(subdomain)),
    byHostname: (hostname: string) => get(`host:${hostname}`, () => loaders.byHostname(hostname)),
    /** Drop cached entries for a store (all of its hosts) and optionally a hostname. */
    invalidate(storeId: string, alsoHostname?: string) {
      for (const key of keysByStore.get(storeId) ?? []) cache.delete(key);
      keysByStore.delete(storeId);
      if (alsoHostname) cache.delete(`host:${alsoHostname}`);
    },
    clear() {
      cache.clear();
      keysByStore.clear();
    },
  } satisfies StoreResolver & Record<string, unknown>;
}
