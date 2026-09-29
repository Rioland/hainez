import "server-only";
import { updateTag } from "next/cache";

/**
 * Cache tags for a store's public data. The storefront (Stage 3) caches with
 * these tags; dashboard mutations expire them. Server Actions only.
 */
export const storeTags = {
  store: (storeId: string) => `store:${storeId}`,
  catalog: (storeId: string) => `store:${storeId}:catalog`,
  settings: (storeId: string) => `store:${storeId}:settings`,
};

export function catalogChanged(storeId: string) {
  updateTag(storeTags.catalog(storeId));
}

export function settingsChanged(storeId: string) {
  updateTag(storeTags.settings(storeId));
  updateTag(storeTags.store(storeId));
}
