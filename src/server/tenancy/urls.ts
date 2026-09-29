import { env } from "../env";
import type { RoutingConfig } from "./routing";

export const routingConfig: RoutingConfig = {
  mode: env.ROUTING_MODE,
  rootDomain: env.ROOT_DOMAIN,
  useHttps: env.USE_HTTPS,
  enforceCanonicalHost: env.ENFORCE_CANONICAL_HOST,
};

const proto = () => (routingConfig.useHttps ? "https" : "http");
const withSlash = (path: string) => (path.startsWith("/") ? path : `/${path}`);

/** Absolute URL on the platform app (marketing, auth, dashboard). */
export function platformUrl(path = "/"): string {
  const { mode, rootDomain } = routingConfig;
  return mode === "path"
    ? `${proto()}://${rootDomain}${withSlash(path)}`
    : `${proto()}://app.${rootDomain}${withSlash(path)}`;
}

/** Absolute URL on the super-admin surface. */
export function superadminUrl(path = "/"): string {
  const { mode, rootDomain } = routingConfig;
  const p = withSlash(path);
  return mode === "path" ? `${proto()}://${rootDomain}/admin${p === "/" ? "" : p}` : `${proto()}://admin.${rootDomain}${p}`;
}

/**
 * Public storefront URL for a store. If the store has an active primary custom
 * domain, pass it and that wins.
 */
export function storefrontUrl(subdomain: string, path = "/", primaryHost?: string | null): string {
  const p = withSlash(path);
  if (primaryHost) return `https://${primaryHost}${p}`;
  const { mode, rootDomain } = routingConfig;
  return mode === "path"
    ? `${proto()}://${rootDomain}/store/${subdomain}${p === "/" ? "" : p}`
    : `${proto()}://${subdomain}.${rootDomain}${p}`;
}

export function dashboardUrl(subdomain: string, path = "/"): string {
  const p = withSlash(path);
  return platformUrl(`/dashboard/${subdomain}${p === "/" ? "" : p}`);
}
