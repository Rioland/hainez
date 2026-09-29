import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader, Table } from "@/components/dashboard";
import { OrderStatusBadge } from "@/components/order-badge";
import { Card } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { getCustomer } from "@/server/modules/customers/customers";
import { getStoreCurrency } from "@/server/modules/settings/settings";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/platform/dashboard/[store]/customers/[customerId]">) {
  const { store: subdomain, customerId } = await params;
  const { store } = await requireStoreRole(subdomain);
  const { customer, currency } = await withTenant(store.storeId, async (tx) => ({
    customer: await getCustomer(tx, store.storeId, customerId),
    currency: await getStoreCurrency(tx, store.storeId),
  }));
  if (!customer) notFound();

  return (
    <div className="space-y-6">
      <Link href={`/dashboard/${subdomain}/customers`} className="text-sm text-muted hover:underline">
        ← Customers
      </Link>
      <PageHeader title={customer.name ?? customer.email} description={`Customer since ${customer.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Orders</p>
          <p className="mt-1 text-2xl font-semibold">{customer.orderCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Total spent</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(customer.totalSpentMinor, currency)}</p>
        </Card>
        <Card className="text-sm">
          <p className="text-muted">Contact</p>
          <p className="mt-1">{customer.email}</p>
          <p>{customer.phone ?? "—"}</p>
          <p className="mt-1 text-xs text-muted">
            {customer.hasAccount ? "Has an account" : "Guest"} · {customer.acceptsMarketing ? "Subscribed to emails" : "Not subscribed"}
          </p>
        </Card>
      </div>
      <Table head={["Order", "Date", "Status", "Total"]} empty={customer.orders.length === 0 && <EmptyState title="No orders" />}>
        {customer.orders.map((o) => (
          <tr key={o.id}>
            <td>
              <Link href={`/dashboard/${subdomain}/orders/${o.id}`} className="font-medium hover:underline">
                #{o.orderNumber}
              </Link>
            </td>
            <td className="text-muted">{o.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</td>
            <td>
              <OrderStatusBadge status={o.status} />
            </td>
            <td>{formatMoney(o.totalMinor, o.currency)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
