import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/order-badge";
import { CustomerLogoutButton } from "@/components/storefront/customer-auth-form";
import { Container } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { withTenant } from "@/server/db/tenant";
import { listCustomerOrders } from "@/server/modules/storefront/checkout";
import { requestBasePath } from "@/server/modules/storefront/context";
import { getCurrentCustomer } from "@/server/modules/storefront/customer-auth";
import { logoutAction } from "../actions";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export default async function AccountPage({ params }: PageProps<"/s/[storeId]/account">) {
  const { storeId } = await params;
  const [base, customer] = await Promise.all([requestBasePath(), getCurrentCustomer(storeId)]);
  // A prompt rather than redirect(): signing out re-renders this page mid-action,
  // and a redirect here would race the client's own navigation.
  if (!customer) {
    return (
      <Container className="max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="mt-2 text-muted">Sign in to see your orders.</p>
        <Link href={`${base}/account/login`} className="mt-6 inline-flex rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground">
          Sign in
        </Link>
      </Container>
    );
  }
  const orders = await withTenant(storeId, (tx) => listCustomerOrders(tx, storeId, customer));

  return (
    <Container className="max-w-3xl py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Hi, {customer.name?.split(" ")[0] ?? "there"}</h1>
          <p className="mt-1 text-sm text-muted">
            {customer.email}
            {customer.phone && ` · ${customer.phone}`}
          </p>
        </div>
        <CustomerLogoutButton action={logoutAction} />
      </div>

      <h2 className="mt-10 mb-3 text-lg font-semibold">Your orders</h2>
      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
          <p>No orders yet.</p>
          <Link href={`${base}/search`} className="mt-3 inline-block text-brand hover:underline">
            Start shopping
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`${base}/order/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 hover:bg-slate-50">
                <span className="font-medium">#{o.orderNumber}</span>
                <OrderStatusBadge status={o.status} />
                <span className="text-sm text-muted">
                  {o.createdAt.toLocaleDateString("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" })} · {o.itemCount}{" "}
                  {o.itemCount === 1 ? "item" : "items"}
                </span>
                <span className="ml-auto font-medium">{formatMoney(o.totalMinor, o.currency)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">
        Orders you placed as a guest (without signing in) aren&apos;t listed here yet. Use the link on their confirmation page to check on them.
      </p>
    </Container>
  );
}
