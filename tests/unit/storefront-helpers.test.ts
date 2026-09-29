import { describe, expect, it } from "vitest";
import { availability, deliveryPrice, MAX_LINE_QTY, methodCoversState } from "@/lib/availability";
import { rateLimit, resetRateLimits } from "@/server/security/rate-limit";

describe("availability", () => {
  it("untracked or backorderable variants are always buyable, up to the line cap", () => {
    expect(availability({ trackInventory: false, allowBackorder: false, stockQuantity: 0 })).toEqual({ available: true, maxQty: MAX_LINE_QTY, low: false });
    expect(availability({ trackInventory: true, allowBackorder: true, stockQuantity: -4 })).toEqual({ available: true, maxQty: MAX_LINE_QTY, low: false });
  });

  it("tracked stock limits the quantity and flags low stock", () => {
    expect(availability({ trackInventory: true, allowBackorder: false, stockQuantity: 3 })).toEqual({ available: true, maxQty: 3, low: true });
    expect(availability({ trackInventory: true, allowBackorder: false, stockQuantity: 40 })).toEqual({ available: true, maxQty: 40, low: false });
    expect(availability({ trackInventory: true, allowBackorder: false, stockQuantity: 5000 }).maxQty).toBe(MAX_LINE_QTY);
  });

  it("no stock (or negative stock) is unavailable", () => {
    expect(availability({ trackInventory: true, allowBackorder: false, stockQuantity: 0 })).toEqual({ available: false, maxQty: 0, low: false });
    expect(availability({ trackInventory: true, allowBackorder: false, stockQuantity: -2 }).available).toBe(false);
  });
});

describe("delivery rules", () => {
  it("an option with no regions covers every state", () => {
    expect(methodCoversState([], "LA")).toBe(true);
    expect(methodCoversState(["LA", "OG"], "OG")).toBe(true);
    expect(methodCoversState(["LA", "OG"], "KN")).toBe(false);
  });

  it("is free from the threshold upwards", () => {
    expect(deliveryPrice({ priceMinor: 250_000, freeOverMinor: null }, 10_000_000)).toBe(250_000);
    expect(deliveryPrice({ priceMinor: 250_000, freeOverMinor: 5_000_000 }, 4_999_999)).toBe(250_000);
    expect(deliveryPrice({ priceMinor: 250_000, freeOverMinor: 5_000_000 }, 5_000_000)).toBe(0);
  });
});

describe("rateLimit", () => {
  it("allows `limit` hits per window, then refuses until the window ends", () => {
    resetRateLimits();
    const t = 1_000_000;
    expect(rateLimit("k", 3, 60_000, t).ok).toBe(true);
    expect(rateLimit("k", 3, 60_000, t + 1).ok).toBe(true);
    expect(rateLimit("k", 3, 60_000, t + 2).ok).toBe(true);
    const blocked = rateLimit("k", 3, 60_000, t + 30_000);
    expect(blocked).toEqual({ ok: false, retryAfterSec: 30 });
    // Other keys are independent.
    expect(rateLimit("other", 3, 60_000, t + 30_000).ok).toBe(true);
    // New window.
    expect(rateLimit("k", 3, 60_000, t + 60_000).ok).toBe(true);
  });
});
