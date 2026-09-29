import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderStatusBadge } from "@/components/order-badge";
import { Container } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { withTenant } from "@/server/db/tenant";
import { getOrderForShopper } from "@/server/modules/storefront/checkout";
import { requestBasePath } from "@/server/modules/storefront/context";
import { getCurrentCustomer } from "@/server/modules/storefront/customer-auth";
import { verifyOrderViewToken } from "@/server/security/tokens";

/*
 * Order confirmation / status page. Reachable two ways:
 *   - the secret link from checkout (?t=HMAC of the order id), for guests
 *   - signed in to the customer account that placed it
 * Anything else is a plain 404 (no hint that the order exists).
 */

// The URL may carry the view token: keep it out of Referer headers.
export const metadata: Metadata = { title: "Your order", robots: { index: false }, referrer: "same-origin" };

const STATUS_TEXT = {
  pending: "We've received your order and the store will get it ready.",
  paid: "Payment received. Your order is being prepared.",
  shipped: "Your order is on its way.",
  delivered: "Your order has been delivered. Enjoy!",
  cancelled: "This order was cancelled.",
} as const;

const PAYMENT_TEXT: Record<string, string> = {
  pay_on_delivery: "Pay on delivery",
  bank_transfer: "Bank transfer",
  online: "Paid online",
};

/** Placed in the last half hour: show the "thank you" banner. (Server component, renders once per request.) */
function isFresh(createdAt: Date) {
  return Date.now() - createdAt.getTime() < 30 * 60_000;
}

export default async function OrderPage({ params, searchParams }: PageProps<"/s/[storeId]/order/[orderId]">) {
  const [{ storeId, orderId }, sp] = await Promise.all([params, searchParams]);
  const token = typeof sp.t === "string" ? sp.t : undefined;
  const [customer, base] = await Promise.all([getCurrentCustomer(storeId), requestBasePath()]);
  const order = await withTenant(storeId, (tx) =>
    getOrderForShopper(tx, storeId, orderId, { tokenValid: verifyOrderViewToken(orderId, token), customer }),
  );
  if (!order) notFound();

  const money = (m: number) => formatMoney(m, order.currency);
  const a = order.shippingAddress;
  const justPlaced = order.status === "pending" && isFresh(order.createdAt);
  const firstName = a.fullName.split(" ")[0];

  return (
    <Container className="max-w-3xl py-10">
      {justPlaced ? (
        <div className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
          <h1 className="text-2xl font-semibold text-emerald-900">Thank you, {firstName}! Your order is placed.</h1>
          <p className="mt-1 text-emerald-800">
            Order #{order.orderNumber} · we&apos;ll contact you on {order.phone ?? a.phone} about delivery.
          </p>
        </div>
      ) : (
        <h1 className="mb-6 text-3xl font-semibold">Order #{order.orderNumber}</h1>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <OrderStatusBadge status={order.status} />
        <p className="text-sm text-muted">{STATUS_TEXT[order.status]}</p>
      </div>

      <section className="rounded-2xl border border-border">
        <ul className="divide-y divide-border">
          {order.items.map((i) => (
            <li key={i.id} className="flex items-center gap-4 p-4">
              <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-slate-50">
                {i.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.imageUrl} alt={i.productTitle} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex-1">
                <p className="font-medium">{i.productTitle}</p>
                {i.variantTitle && <p className="text-sm text-muted">{i.variantTitle}</p>}
                <p className="text-sm text-muted">
                  {money(i.unitPriceMinor)} × {i.quantity}
                </p>
              </div>
              <p className="font-medium">{money(i.lineTotalMinor)}</p>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-border p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Subtotal</dt>
            <dd>{money(order.subtotalMinor)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Delivery{order.shippingMethodName && ` (${order.shippingMethodName})`}</dt>
            <dd>{order.shippingMinor ? money(order.shippingMinor) : "Free"}</dd>
          </div>
          {order.discountMinor > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Discount</dt>
              <dd>−{money(order.discountMinor)}</dd>
            </div>
          )}
          <div className="flex justify-between pt-1 text-base font-semibold">
            <dt>Total</dt>
            <dd>{money(order.totalMinor)}</dd>
          </div>
        </dl>
      </section>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section className="rounded-2xl border border-border p-5 text-sm">
          <h2 className="mb-2 font-medium">Delivery address</h2>
          <address className="not-italic leading-relaxed text-muted">
            {a.fullName}
            <br />
            {a.line1}
            {a.line2 && (
              <>
                <br />
                {a.line2}
              </>
            )}
            <br />
            {a.city}, {a.state}
            <br />
            {a.phone}
          </address>
          {order.trackingNumber && (
            <p className="mt-3">
              Tracking: <span className="font-mono">{order.trackingNumber}</span>
            </p>
          )}
        </section>
        <section className="rounded-2xl border border-border p-5 text-sm">
          <h2 className="mb-2 font-medium">Payment</h2>
          <p>{PAYMENT_TEXT[order.paymentMethod] ?? order.paymentMethod}</p>
          {order.paymentMethod === "pay_on_delivery" && order.status === "pending" && (
            <p className="mt-1 text-muted">Please have {money(order.totalMinor)} ready when your order arrives.</p>
          )}
          <p className="mt-3 text-muted">
            Placed {order.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}
            <br />
            Confirmation for {order.email}
          </p>
          {order.customerNote && <p className="mt-3 text-muted">Note: {order.customerNote}</p>}
        </section>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4 text-sm">
        <Link href={base || "/"} className="rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground hover:opacity-90">
          Continue shopping
        </Link>
        {customer ? (
          <Link href={`${base}/account`} className="text-muted hover:underline">
            All your orders
          </Link>
        ) : (
          <p className="text-muted">Bookmark this page to check your order status later.</p>
        )}
      </div>
    </Container>
  );
}
