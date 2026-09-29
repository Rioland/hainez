import Link from "next/link";
import { Container } from "@/components/ui";
import { requireStoreRole } from "@/server/auth/guards";
import { storefrontUrl } from "@/server/tenancy/urls";

const NAV = [
  { label: "Overview", path: "", stage: null },
  { label: "Orders", path: "/orders", stage: null },
  { label: "Products", path: "/products", stage: null },
  { label: "Categories", path: "/categories", stage: null },
  { label: "Customers", path: "/customers", stage: null },
  { label: "Settings", path: "/settings", stage: null },
  { label: "Appearance", path: "/appearance", stage: 4 },
  { label: "Billing", path: "/billing", stage: 6 },
  { label: "Domains", path: "/domains", stage: 8 },
] as const;

const NOTICES = {
  grace_period: "Your subscription has lapsed. Renew within the grace period to keep your store online.",
  billing_suspended: "Your store is offline because the subscription wasn't renewed. The dashboard is read-only.",
  cancelled: "This store's subscription is cancelled. The dashboard is read-only.",
  admin_suspended: "This store has been suspended by the platform. Contact support.",
} as const;

export default async function StoreDashboardLayout({ children, params }: LayoutProps<"/platform/dashboard/[store]">) {
  const { store: subdomain } = await params;
  const { store, access, role } = await requireStoreRole(subdomain);
  const base = `/dashboard/${store.subdomain}`;

  return (
    <div className="flex flex-1 flex-col">
      {access.notice && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          {NOTICES[access.notice]}
        </div>
      )}
      {store.billingStatus === "trialing" && !access.notice && (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-center text-sm text-sky-900">
          Free trial · ends {store.trialEndsAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}
        </div>
      )}
      <Container className="grid flex-1 gap-8 py-8 md:grid-cols-[200px_minmax(0,1fr)]">
        <aside>
          <p className="truncate font-semibold">{store.name}</p>
          <a href={storefrontUrl(store.subdomain)} className="text-xs text-brand hover:underline" target="_blank">
            View store ↗
          </a>
          <p className="mt-1 text-xs text-muted">Your role: {role}</p>
          <nav className="mt-6 flex flex-col gap-1 text-sm">
            {NAV.map((item) =>
              item.stage ? (
                <span key={item.label} className="flex justify-between rounded-md px-2 py-1.5 text-muted" title="Coming soon">
                  {item.label} <span className="text-xs">Stage {item.stage}</span>
                </span>
              ) : (
                <Link key={item.label} href={`${base}${item.path}`} className="rounded-md px-2 py-1.5 hover:bg-white">
                  {item.label}
                </Link>
              ),
            )}
          </nav>
        </aside>
        <section className="min-w-0">{children}</section>
      </Container>
    </div>
  );
}
