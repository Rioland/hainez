import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/ui";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { formatMoney } from "@/lib/money";
import { withTenant } from "@/server/db/tenant";
import { getCurrentCart } from "@/server/modules/storefront/cart";
import { listDeliveryOptions } from "@/server/modules/storefront/checkout";
import { requestBasePath } from "@/server/modules/storefront/context";
import { getCurrentCustomer } from "@/server/modules/storefront/customer-auth";
import { NG_STATES } from "@/server/modules/settings/settings";
import { placeOrderAction } from "../actions";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ params }: PageProps<"/s/[storeId]/checkout">) {
  const { storeId } = await params;
  const [cart, base, customer] = await Promise.all([getCurrentCart(storeId), requestBasePath(), getCurrentCustomer(storeId)]);
  if (cart.lines.length === 0 || cart.hasIssues) redirect(`${base}/cart`);
  const deliveries = await withTenant(storeId, (tx) => listDeliveryOptions(tx, storeId));

  return (
    <Container className="py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-semibold">Checkout</h1>
        {!customer && (
          <p className="text-sm text-muted">
            Have an account?{" "}
            <Link href={`${base}/account/login?next=${encodeURIComponent(`${base}/checkout`)}`} className="text-brand hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </div>
      <details className="mb-6 rounded-xl border border-border p-4 text-sm">
        <summary className="cursor-pointer font-medium">
          {cart.itemCount} items · {formatMoney(cart.subtotal, cart.currency)}
        </summary>
        <ul className="mt-3 space-y-1 text-muted">
          {cart.lines.map((l) => (
            <li key={l.itemId} className="flex justify-between gap-4">
              <span>
                {l.productTitle}
                {l.variantTitle && ` (${l.variantTitle})`} × {l.quantity}
              </span>
              <span>{formatMoney(l.lineTotal, cart.currency)}</span>
            </li>
          ))}
        </ul>
      </details>
      {deliveries.length === 0 ? (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-amber-800">This store hasn&apos;t set up delivery yet, so orders can&apos;t be placed. Please check back soon.</p>
      ) : (
        <CheckoutForm
          action={placeOrderAction}
          states={NG_STATES}
          deliveries={deliveries}
          subtotal={cart.subtotal}
          currency={cart.currency}
          customer={customer ? { email: customer.email, name: customer.name, phone: customer.phone } : null}
        />
      )}
    </Container>
  );
}
