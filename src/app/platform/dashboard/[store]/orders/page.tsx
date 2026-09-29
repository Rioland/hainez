import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, FilterTabs, PageHeader, Pagination, Table } from "@/components/dashboard";
import { OrderStatusBadge } from "@/components/order-badge";
import { formatMoney } from "@/lib/money";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { listOrders } from "@/server/modules/orders/orders";

export const metadata: Metadata = { title: "Orders" };

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export default async function OrdersPage({ params, searchParams }: PageProps<"/platform/dashboard/[store]/orders">) {
  const { store: subdomain } = await params;
  const sp = await searchParams;
  const filters = { status: str(sp.status), q: str(sp.q), from: str(sp.from), to: str(sp.to) };
  const { store } = await requireStoreRole(subdomain);
  const list = await withTenant(store.storeId, (tx) => listOrders(tx, store.storeId, { ...filters, page: sp.page }));
  const base = `/dashboard/${subdomain}/orders`;
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div>
      <PageHeader title="Orders" description="Orders placed in your store. Checkout arrives with the storefront in Stage 3." />
      <FilterTabs
        base={base}
        param="status"
        current={filters.status}
        keep={{ q: filters.q, from: filters.from, to: filters.to }}
        options={[
          { value: undefined, label: "All" },
          { value: "pending", label: "Unpaid" },
          { value: "paid", label: "To ship" },
          { value: "shipped", label: "Shipped" },
          { value: "delivered", label: "Delivered" },
          { value: "cancelled", label: "Cancelled" },
        ]}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" action={base}>
        {filters.status && <input type="hidden" name="status" value={filters.status} />}
        <input name="q" defaultValue={filters.q} placeholder="Order #, email or name" className="min-w-56 flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm" />
        <label className="text-xs text-muted">
          From
          <input type="date" name="from" defaultValue={filters.from} className="ml-1 rounded-lg border border-border bg-white px-2 py-2 text-sm" />
        </label>
        <label className="text-xs text-muted">
          To
          <input type="date" name="to" defaultValue={filters.to} className="ml-1 rounded-lg border border-border bg-white px-2 py-2 text-sm" />
        </label>
        <button className="rounded-lg border border-border bg-white px-4 py-2 text-sm hover:bg-slate-50">Filter</button>
        {filtered && (
          <Link href={base} className="px-2 py-2 text-sm text-muted hover:underline">
            Clear
          </Link>
        )}
      </form>

      <Table
        head={["Order", "Date", "Customer", "Status", "Items", "Total"]}
        empty={list.rows.length === 0 && <EmptyState title={filtered ? "No orders match these filters" : "No orders yet"} />}
      >
        {list.rows.map((o) => (
          <tr key={o.id} className="hover:bg-slate-50">
            <td>
              <Link href={`${base}/${o.id}`} className="font-medium hover:underline">
                #{o.orderNumber}
              </Link>
            </td>
            <td className="whitespace-nowrap text-muted">{o.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</td>
            <td>
              <div>{o.customerName ?? "—"}</div>
              <div className="text-xs text-muted">{o.email}</div>
            </td>
            <td>
              <OrderStatusBadge status={o.status} />
            </td>
            <td>{o.itemCount}</td>
            <td className="whitespace-nowrap font-medium">{formatMoney(o.totalMinor, o.currency)}</td>
          </tr>
        ))}
      </Table>
      <Pagination base={base} page={list.page} pageCount={list.pageCount} total={list.total} params={filters} />
    </div>
  );
}
