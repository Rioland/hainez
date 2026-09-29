import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Pagination, Table } from "@/components/dashboard";
import { Badge } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { listCustomers } from "@/server/modules/customers/customers";
import { getStoreCurrency } from "@/server/modules/settings/settings";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ params, searchParams }: PageProps<"/platform/dashboard/[store]/customers">) {
  const { store: subdomain } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const { store } = await requireStoreRole(subdomain);
  const { list, currency } = await withTenant(store.storeId, async (tx) => ({
    list: await listCustomers(tx, store.storeId, { q, page: sp.page }),
    currency: await getStoreCurrency(tx, store.storeId),
  }));
  const base = `/dashboard/${subdomain}/customers`;

  return (
    <div>
      <PageHeader title="Customers" description="People who have ordered from your store." />
      <form className="mb-4 flex gap-2" action={base}>
        <input name="q" defaultValue={q} placeholder="Search name, email or phone" className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm" />
        <button className="rounded-lg border border-border bg-white px-4 py-2 text-sm hover:bg-slate-50">Search</button>
      </form>
      <Table
        head={["Customer", "Phone", "Orders", "Total spent", "Last order"]}
        empty={list.rows.length === 0 && <EmptyState title={q ? "No customers match" : "No customers yet"} />}
      >
        {list.rows.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50">
            <td>
              <Link href={`${base}/${c.id}`} className="font-medium hover:underline">
                {c.name ?? c.email}
              </Link>
              <div className="text-xs text-muted">
                {c.email} {c.hasAccount && <Badge>account</Badge>}
              </div>
            </td>
            <td className="text-muted">{c.phone ?? "—"}</td>
            <td>{c.orderCount}</td>
            <td className="whitespace-nowrap">{formatMoney(c.totalSpentMinor, currency)}</td>
            <td className="whitespace-nowrap text-muted">{c.lastOrderAt ? c.lastOrderAt.toLocaleDateString("en-NG", { dateStyle: "medium" }) : "—"}</td>
          </tr>
        ))}
      </Table>
      <Pagination base={base} page={list.page} pageCount={list.pageCount} total={list.total} params={{ q }} />
    </div>
  );
}
