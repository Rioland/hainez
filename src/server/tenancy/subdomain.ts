/**
 * Store subdomain rules. Shared by signup (Stage 5), the proxy and tests.
 * Kept free of server-only imports so it can run anywhere.
 */

/** Names no store may claim. The DB table reserved_subdomains can add more. */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  // platform surfaces
  "www", "app", "admin", "api", "dashboard", "account", "accounts", "auth", "login", "signup", "register",
  "billing", "checkout", "pay", "payments", "store", "stores", "shop", "shops",
  // infrastructure
  "mail", "email", "smtp", "imap", "pop", "mx", "ns", "ns1", "ns2", "dns", "cdn", "static", "assets",
  "media", "img", "images", "files", "uploads", "ftp", "sftp", "ssh", "vpn", "proxy", "webhooks", "hooks",
  "status", "health", "metrics", "monitoring", "internal", "localhost", "test", "staging", "dev", "demo-admin",
  // support / content
  "help", "support", "docs", "blog", "about", "contact", "legal", "terms", "privacy", "security", "abuse",
  "root", "system", "superadmin", "sysadmin", "administrator", "moderator", "official", "team",
];

const SUBDOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export type SubdomainCheck =
  | { ok: true; value: string }
  | { ok: false; reason: "too_short" | "too_long" | "invalid_characters" | "double_hyphen" | "reserved" };

/**
 * Normalise and validate a requested subdomain. Uniqueness is checked separately
 * against the database (and enforced by a UNIQUE constraint).
 */
export function checkSubdomain(input: string, extraReserved: Iterable<string> = []): SubdomainCheck {
  const value = input.trim().toLowerCase();
  if (value.length < 3) return { ok: false, reason: "too_short" };
  if (value.length > 63) return { ok: false, reason: "too_long" };
  if (!SUBDOMAIN_RE.test(value)) return { ok: false, reason: "invalid_characters" };
  // "xn--" style labels are punycode; "a--b" is confusing for users. Block both.
  if (value.includes("--")) return { ok: false, reason: "double_hyphen" };
  const reserved = new Set([...RESERVED_SUBDOMAINS, ...extraReserved]);
  if (reserved.has(value)) return { ok: false, reason: "reserved" };
  return { ok: true, value };
}

/** Cheap syntactic check used by the proxy before touching the database. */
export function looksLikeSubdomain(value: string): boolean {
  return SUBDOMAIN_RE.test(value);
}
