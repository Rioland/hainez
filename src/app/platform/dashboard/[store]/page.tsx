import { count } from "drizzle-orm";
import type { Metadata } from "next";
import { Card } from "@/components/ui";
import { requireStoreRole } from "@/server/auth/guards";
import { domains, stores } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { storefrontUrl } from "@/server/tenancy/urls";

export const metadata: Metadata = { title: "Overview" };

export default async function StoreOverviewPage({ params }: PageProps<"/platform/dashboard/[store]">) {
  const { store: subdomain } = await params;
  const { store } = await requireStoreRole(subdomain);

  // Everything store-scoped runs inside withTenant(): RLS limits every query to
  // this store, even though no WHERE store_id is written here.
  const { settings, domainCount } = await withTenant(store.storeId, async (tx) => {
    const [settings] = await tx
      .select({ currency: stores.currency, timezone: stores.timezone, createdAt: stores.createdAt })
      .from(stores);
    const [{ n }] = await tx.select({ n: count() }).from(domains);
    return { settings, domainCount: n };
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Sales (30 days)</p>
          <p className="mt-1 text-2xl font-semibold">—</p>
          <p className="mt-1 text-xs text-muted">Orders arrive in Stage 2–3</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Currency</p>
          <p className="mt-1 text-2xl font-semibold">{settings.currency}</p>
          <p className="mt-1 text-xs text-muted">{settings.timezone}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Custom domains</p>
          <p className="mt-1 text-2xl font-semibold">{domainCount}</p>
        </Card>
      </div>
      <Card>
        <p className="font-medium">Your store address</p>
        <p className="mt-1 font-mono text-sm">{storefrontUrl(store.subdomain)}</p>
        <p className="mt-4 text-sm text-muted">
          Getting started checklist (logo, colours, first product) arrives with signup in Stage 5.
        </p>
      </Card>
    </div>
  );
}
