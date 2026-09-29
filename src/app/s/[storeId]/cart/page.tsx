import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/ui";
import { CartLines } from "@/components/storefront/cart-lines";
import { formatMoney } from "@/lib/money";
import { getCurrentCart } from "@/server/modules/storefront/cart";
import { requestBasePath } from "@/server/modules/storefront/context";
import { updateCartItemAction } from "../actions";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage({ params }: PageProps<"/s/[storeId]/cart">) {
  const { storeId } = await params;
  const [cart, base] = await Promise.all([getCurrentCart(storeId), requestBasePath()]);

  return (
    <Container className="py-10">
      <h1 className="text-3xl font-semibold">Your cart</h1>
      {cart.lines.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-muted">Your cart is empty.</p>
          <Link href={`${base}/search`} className="mt-4 inline-flex rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground">
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_340px]">
          <CartLines lines={cart.lines} currency={cart.currency} base={base} update={updateCartItemAction} />
          <aside className="h-fit rounded-2xl border border-border p-6">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Subtotal ({cart.itemCount} items)</span>
              <span className="font-semibold">{formatMoney(cart.subtotal, cart.currency)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">Delivery is calculated at checkout.</p>
            {cart.hasIssues ? (
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Please fix the items marked above before checking out.</p>
            ) : (
              <Link href={`${base}/checkout`} className="mt-4 block rounded-full bg-brand px-6 py-3 text-center font-medium text-brand-foreground hover:opacity-90">
                Checkout
              </Link>
            )}
            <Link href={`${base}/search`} className="mt-3 block text-center text-sm text-muted hover:underline">
              Continue shopping
            </Link>
          </aside>
        </div>
      )}
    </Container>
  );
}
