import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env";

/** 256-bit random token, URL-safe. Used for cart and session cookies. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What we store instead of the raw token: a stolen DB row can't be replayed as a cookie. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Unguessable link token for a guest to view their own order
 * (/order/{id}?t=...). Deterministic HMAC, so nothing extra is stored.
 */
export function orderViewToken(orderId: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`order-view:${orderId}`).digest("base64url").slice(0, 32);
}

export function verifyOrderViewToken(orderId: string, token: string | undefined | null): boolean {
  if (!token) return false;
  const expected = Buffer.from(orderViewToken(orderId));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
