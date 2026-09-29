import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { getStorefrontStore } from "@/server/modules/storefront/store";
import { getStoreAccess } from "@/server/tenancy/access";

export const metadata: Metadata = { title: "Temporarily unavailable", robots: { index: false } };

/**
 * Served with HTTP 503 by the proxy when a store's storefront is closed
 * (grace period over, cancelled, or suspended by the platform).
 */
export default async function StoreUnavailable({ params }: PageProps<"/s/[storeId]/unavailable">) {
  const store = (await getStorefrontStore((await params).storeId))!;
  const access = getStoreAccess({
    billingStatus: store.billingStatus,
    adminSuspended: store.adminSuspendedAt !== null,
  });
  // An open store has no "unavailable" page.
  if (access.storefront === "open") notFound();

  return (
    <Container className="flex flex-1 flex-col items-center justify-center py-24 text-center">
      <h1 className="text-3xl font-semibold">We&apos;ll be back soon</h1>
      <p className="mt-2 max-w-md text-muted">
        {store.name} is temporarily unavailable. Please check back later.
      </p>
    </Container>
  );
}
