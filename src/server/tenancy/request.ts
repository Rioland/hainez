import "server-only";
import { headers } from "next/headers";
import { TENANT_HEADERS } from "./routing";

/**
 * Per-request values set by the proxy. The proxy strips any client-sent copies,
 * so these can be trusted.
 */

/** "" on subdomain/custom-domain hosts, "/store/{sub}" or "/admin" in path mode. */
export async function getBasePath(): Promise<string> {
  return (await headers()).get(TENANT_HEADERS.basePath) ?? "";
}

/** Prefix an in-app path with the current base path. */
export async function href(path: string): Promise<string> {
  const base = await getBasePath();
  const p = path.startsWith("/") ? path : `/${path}`;
  return base && p === "/" ? base : `${base}${p}`;
}
