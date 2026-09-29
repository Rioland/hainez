import Link from "next/link";
import { Container } from "@/components/ui";
import { CustomerAuthForm } from "@/components/storefront/customer-auth-form";
import { requestBasePath } from "@/server/modules/storefront/context";
import { getCurrentCustomer } from "@/server/modules/storefront/customer-auth";
import { customerAuthAction } from "../actions";

/** Shared body of /account/login and /account/register. */
export async function CustomerAuthPage({ storeId, mode, next }: { storeId: string; mode: "login" | "register"; next: unknown }) {
  const [base, customer] = await Promise.all([requestBasePath(), getCurrentCustomer(storeId)]);
  // Only same-store paths; the action checks again.
  const target = typeof next === "string" && next.startsWith(`${base}/`) && !next.startsWith("//") ? next : `${base}/account`;
  const other = mode === "login" ? "register" : "login";
  const switchHref = `${base}/account/${other}${target === `${base}/account` ? "" : `?next=${encodeURIComponent(target)}`}`;

  // Already signed in (also what renders right after a successful sign-in,
  // while the client navigates on): a link, not redirect(), for the same reason
  // as the account page.
  if (customer) {
    return (
      <Container className="max-w-md py-16 text-center">
        <p className="text-muted">You&apos;re signed in as {customer.email}.</p>
        <Link href={target} className="mt-4 inline-flex rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground">
          Continue
        </Link>
      </Container>
    );
  }

  return (
    <Container className="flex justify-center py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          {mode === "login" ? "Track your orders and check out faster." : "Save your details and see your orders in one place."}
        </p>
        <CustomerAuthForm mode={mode} action={customerAuthAction.bind(null, mode)} next={target} switchHref={switchHref} />
      </div>
    </Container>
  );
}
