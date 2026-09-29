/** Stock rules shared by the storefront (client + server) and checkout. */

export const MAX_LINE_QTY = 999;

export type StockFields = { trackInventory: boolean; allowBackorder: boolean; stockQuantity: number };

/** Can this variant be bought, and how many at most? */
export function availability(v: StockFields): { available: boolean; maxQty: number; low: boolean } {
  if (!v.trackInventory || v.allowBackorder) return { available: true, maxQty: MAX_LINE_QTY, low: false };
  const stock = Math.max(0, v.stockQuantity);
  return { available: stock > 0, maxQty: Math.min(stock, MAX_LINE_QTY), low: stock > 0 && stock <= 5 };
}

/** A delivery option with no regions ships everywhere; otherwise the state must be listed. */
export function methodCoversState(regions: string[], stateCode: string): boolean {
  return regions.length === 0 || regions.includes(stateCode);
}

/** Delivery price for a subtotal (free above the threshold, if any). */
export function deliveryPrice(m: { priceMinor: number; freeOverMinor: number | null }, subtotalMinor: number): number {
  return m.freeOverMinor !== null && subtotalMinor >= m.freeOverMinor ? 0 : m.priceMinor;
}
