import type { Metadata } from "next";
import { Badge, billingTone, Card, Container } from "@/components/ui";
import { requireSuperAdmin } from "@/server/auth/guards";
import { listAllStores } from "@/server/modules/superadmin/stores";
import { dashboardUrl, storefrontUrl } from "@/server/tenancy/urls";

export const metadata: Metadata = { title: "Stores" };

// Stage 1: read-only list. Suspend/reactivate, impersonation, plans, revenue
// and the domain-orders queue arrive in Stage 9.
export default async function SuperadminStoresPage() {
  await requireSuperAdmin(); // layouts don't re-run on every navigation; pages re-check
  const stores = await listAllStores();

  return (
    <Container className="py-8">
      <h1 className="text-2xl font-semibold">All stores ({stores.length})</h1>
      <Card className="mt-6 overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-slate-50 text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Store</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Trial ends</th>
              <th className="px-4 py-3">Domain</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <a href={dashboardUrl(s.subdomain)} className="font-medium hover:underline">
                    {s.name}
                  </a>
                  <div className="font-mono text-xs text-muted">{storefrontUrl(s.subdomain)}</div>
                </td>
                <td className="px-4 py-3">{s.ownerEmail ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={s.adminSuspendedAt ? "bad" : billingTone(s.billingStatus)}>
                    {s.adminSuspendedAt ? "admin suspended" : s.billingStatus.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3">{s.trialEndsAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.primaryDomain ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Container>
  );
}
