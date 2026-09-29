/**
 * Only allow same-site relative paths as post-login redirects ("/dashboard"),
 * never absolute or protocol-relative URLs ("https://evil.com", "//evil.com").
 */
export function safeNextPath(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.length > 512) return fallback;
  return value;
}
