import type { Metadata } from "next";
import { ButtonLink, Container } from "@/components/ui";
import { env } from "@/server/env";
import { platformUrl } from "@/server/tenancy/urls";

export const metadata: Metadata = { title: "Store not found", robots: { index: false } };

/**
 * Shown (with HTTP 404) when a host or /store/{name} path doesn't match any
 * store. The proxy rewrites here; it is not reachable directly.
 */
export default function StoreNotFound() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <p className="text-sm font-medium text-brand">404</p>
      <h1 className="mt-2 text-3xl font-semibold">This store doesn&apos;t exist</h1>
      <p className="mt-2 text-muted">Check the address, or create your own store on {env.PLATFORM_NAME}.</p>
      <ButtonLink href={platformUrl("/signup")} className="mt-6">
        Start your free trial
      </ButtonLink>
    </Container>
  );
}
