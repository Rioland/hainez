import "server-only";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { env } from "../../env";
import { TENANT_HEADERS } from "../../tenancy/routing";

/*
 * Per-request storefront context. The proxy resolved the store from the Host
 * (or /store/{name} path) and set these headers, stripping any client copies,
 * so they can be trusted. Storefront server actions use THIS store id, never
 * one sent by the browser.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requestStoreId(): Promise<string> {
  const id = (await headers()).get(TENANT_HEADERS.storeId);
  if (!id || !UUID_RE.test(id)) notFound();
  return id;
}

/** "" normally, "/store/{name}" in path routing mode. */
export async function requestBasePath(): Promise<string> {
  return (await headers()).get(TENANT_HEADERS.basePath) ?? "";
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/**
 * Storefront cookies are scoped to the store: host-only on subdomains/custom
 * domains, and additionally Path=/store/{name} in path mode (several stores
 * share one host there).
 */
export async function storeCookieOptions(maxAgeSec: number) {
  const base = await requestBasePath();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.USE_HTTPS,
    path: base || "/",
    maxAge: maxAgeSec,
  };
}

export async function readCookie(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value;
}
