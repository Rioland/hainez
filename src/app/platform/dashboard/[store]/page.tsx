import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Table } from "@/components/dashboard";
import { OrderStatusBadge } from "@/components/order-badge";
import { ButtonLink, Card } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { getOverview, LOW_STOCK_THRESHOLD } from "@/server/modules/overview/overview";
import { getStoreCurrency } from "@/server/modules/settings/settings";
import { storefrontUrl } from "@/server/tenancy/urls";

export const metadata: Metadata = { title: "Overview" };

export default async function StoreOverviewPage({ params }: PageProps<"/platform/dashboard/[store]">) {
  const { store: subdomain } = await params;
  const { store } = await requireStoreRole(subdomain);
  // Everything store-scoped runs inside withTenant(): RLS limits every query to this store.
  const { o, currency } = await withTenant(store.storeId, async (tx) => ({
    o: await getOverview(tx, store.storeId),
    currency: await getStoreCurrency(tx, store.storeId),
  }));
  const money = (m: number) => formatMoney(m, currency);
  const base = `/dashboard/${subdomain}`;

  const cards = [
    { label: `Sales (${o.days} days)`, value: money(o.salesMinor), note: `Avg order ${money(o.averageOrderMinor)}` },
    { label: `Orders (${o.days} days)`, value: String(o.orders), note: `${o.unpaid} awaiting payment` },
    { label: "To ship", value: String(o.toFulfil), note: "Paid, not yet shipped", href: `${base}/orders?status=paid` },
    { label: "Active products", value: String(o.activeProducts), note: "Visible in your store", href: `${base}/products?status=active` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <a href={storefrontUrl(store.subdomain)} target="_blank" className="text-sm text-brand hover:underline">
          {storefrontUrl(store.subdomain)} ↗
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => {
          const body = (
            <Card className="h-full">
              <p className="text-sm text-muted">{c.label}</p>
              <p className="mt-1 text-2xl font-semibold">{c.value}</p>
              <p className="mt-1 text-xs text-muted">{c.note}</p>
            </Card>
          );
          return c.href ? (
            <Link key={c.label} href={c.href} className="block hover:opacity-90">
              {body}
            </Link>
          ) : (
            <div key={c.label}>{body}</div>
          );
        })}
      </div>

      {o.activeProducts === 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand/30 bg-brand/5">
          <div>
            <p className="font-medium">Add your first product</p>
            <p className="text-sm text-muted">Your store is live, but there&apos;s nothing to buy yet.</p>
          </div>
          <ButtonLink href={`${base}/products/new`}>Add product</ButtonLink>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-medium">Recent orders</h2>
          <Table head={["Order", "Customer", "Status", "Total"]} empty={o.recentOrders.length === 0 && <EmptyState title="No orders yet" />}>
            {o.recentOrders.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`${base}/orders/${r.id}`} className="font-medium hover:underline">
                    #{r.orderNumber}
                  </Link>
                </td>
                <td className="text-muted">{r.customerName ?? "—"}</td>
                <td>
                  <OrderStatusBadge status={r.status} />
                </td>
                <td>{formatMoney(r.totalMinor, r.currency)}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 font-medium">Top products ({o.days} days)</h2>
            <Table head={["Product", "Sold", "Revenue"]} empty={o.topProducts.length === 0 && <EmptyState title="No sales yet" />}>
              {o.topProducts.map((p) => (
                <tr key={`${p.productId}-${p.title}`}>
                  <td>
                    {p.productId ? (
                      <Link href={`${base}/products/${p.productId}`} className="hover:underline">
                        {p.title}
                      </Link>
                    ) : (
                      p.title
                    )}
                  </td>
                  <td>{p.quantity}</td>
                  <td>{money(p.revenueMinor)}</td>
                </tr>
              ))}
            </Table>
          </div>
          {o.lowStock.length > 0 && (
            <div>
              <h2 className="mb-2 font-medium">Low stock (≤ {LOW_STOCK_THRESHOLD})</h2>
              <Table head={["Product", "Stock"]}>
                {o.lowStock.map((v) => (
                  <tr key={`${v.productId}-${v.variantTitle}`}>
                    <td>
                      <Link href={`${base}/products/${v.productId}`} className="hover:underline">
                        {v.productTitle}
                      </Link>
                      {v.variantTitle !== "Default" && <span className="text-muted"> · {v.variantTitle}</span>}
                    </td>
                    <td className={v.stock <= 0 ? "font-medium text-red-600" : ""}>{v.stock}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
