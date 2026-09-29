import type { Metadata } from "next";
import Link from "next/link";
import { Badge, billingTone, Card, Container } from "@/components/ui";
import { requireUser } from "@/server/auth/guards";
import { listStoresForUser } from "@/server/auth/memberships";
import { storefrontUrl } from "@/server/tenancy/urls";

export const metadata: Metadata = { title: "Your stores" };

/** Store picker: a user can own or staff several stores. */
export default async function DashboardHome() {
  const session = await requireUser("/dashboard");
  const stores = await listStoresForUser(session.user.id);

  return (
    <Container className="py-10">
      <h1 className="text-2xl font-semibold">Hi {session.user.name.split(" ")[0]}, pick a store</h1>

      {stores.length === 0 ? (
        <Card className="mt-6">
          <p className="font-medium">You don&apos;t have a store yet.</p>
          <p className="mt-1 text-sm text-muted">
            Creating a store (name, subdomain, 30-day trial) arrives in Stage 5.
          </p>
        </Card>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {stores.map((s) => (
            <li key={s.id}>
              <Card className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/dashboard/${s.subdomain}`} className="text-lg font-semibold hover:underline">
                    {s.name}
                  </Link>
                  <Badge tone={s.adminSuspendedAt ? "bad" : billingTone(s.billingStatus)}>
                    {s.adminSuspendedAt ? "suspended by admin" : s.billingStatus.replace("_", " ")}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {s.role} · <span className="font-mono">{storefrontUrl(s.subdomain)}</span>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
