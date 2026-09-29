import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Thumb } from "@/components/dashboard";
import { OrderStatusBadge } from "@/components/order-badge";
import { Card } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { getOrder } from "@/server/modules/orders/orders";
import { ORDER_STATUS_LABEL } from "@/server/modules/orders/transitions";
import { changeOrderStatusAction, saveOrderNoteAction } from "../actions";
import { OrderStatusControl } from "../order-status";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: PageProps<"/platform/dashboard/[store]/orders/[orderId]">) {
  const { store: subdomain, orderId } = await params;
  const { store, access } = await requireStoreRole(subdomain);
  const order = await withTenant(store.storeId, (tx) => getOrder(tx, store.storeId, orderId));
  if (!order) notFound();
  const money = (m: number) => formatMoney(m, order.currency);
  const a = order.shippingAddress;

  return (
    <div className="space-y-6">
      <Link href={`/dashboard/${subdomain}/orders`} className="text-sm text-muted hover:underline">
        ← Orders
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Order #{order.orderNumber} <OrderStatusBadge status={order.status} />
          </span>
        }
        description={order.createdAt.toLocaleString("en-NG", { dateStyle: "full", timeStyle: "short" })}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="p-0">
            <ul>
              {order.items.map((i) => (
                <li key={i.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0">
                  <Thumb src={i.imageUrl} alt={i.productTitle} size={48} />
                  <div className="flex-1">
                    {i.productId ? (
                      <Link href={`/dashboard/${subdomain}/products/${i.productId}`} className="font-medium hover:underline">
                        {i.productTitle}
                      </Link>
                    ) : (
                      <span className="font-medium">{i.productTitle}</span>
                    )}
                    <div className="text-xs text-muted">
                      {[i.variantTitle, i.sku && `SKU ${i.sku}`].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div>
                      {money(i.unitPriceMinor)} × {i.quantity}
                    </div>
                    <div className="font-medium">{money(i.lineTotalMinor)}</div>
                  </div>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-border px-4 py-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal</dt>
                <dd>{money(order.subtotalMinor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Delivery {order.shippingMethodName && `(${order.shippingMethodName})`}</dt>
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
          </Card>

          <Card>
            <h2 className="mb-3 font-medium">Update order</h2>
            <OrderStatusControl
              status={order.status}
              statusAction={changeOrderStatusAction.bind(null, subdomain, order.id)}
              noteAction={saveOrderNoteAction.bind(null, subdomain, order.id)}
              internalNote={order.internalNote ?? ""}
              readOnly={access.dashboard === "read_only"}
            />
          </Card>

          <Card>
            <h2 className="mb-3 font-medium">History</h2>
            <ol className="space-y-2 text-sm">
              {order.history.map((h) => (
                <li key={h.id} className="flex gap-3">
                  <span className="w-40 shrink-0 text-muted">{h.createdAt.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span>
                    {h.fromStatus ? `${ORDER_STATUS_LABEL[h.fromStatus]} → ` : "Placed · "}
                    {ORDER_STATUS_LABEL[h.toStatus]}
                    {h.note && <span className="text-muted"> — {h.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-1 text-sm">
            <h2 className="mb-2 font-medium">Customer</h2>
            {order.customer ? (
              <Link href={`/dashboard/${subdomain}/customers/${order.customer.id}`} className="font-medium hover:underline">
                {order.customer.name ?? order.customer.email}
              </Link>
            ) : (
              <p>{a.fullName}</p>
            )}
            <p className="text-muted">{order.email}</p>
            {order.phone && <p className="text-muted">{order.phone}</p>}
          </Card>
          <Card className="text-sm">
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
            {order.trackingNumber && <p className="mt-3">Tracking: <span className="font-mono">{order.trackingNumber}</span></p>}
          </Card>
          {order.customerNote && (
            <Card className="text-sm">
              <h2 className="mb-2 font-medium">Customer note</h2>
              <p className="whitespace-pre-line text-muted">{order.customerNote}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
