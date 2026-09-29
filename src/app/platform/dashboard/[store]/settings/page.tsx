import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard";
import { Badge, Card } from "@/components/ui";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/money";
import { requireStoreRole } from "@/server/auth/guards";
import { roleAtLeast } from "@/server/auth/memberships";
import { withTenant } from "@/server/db/tenant";
import { getSettings, listShippingMethods, NG_STATES, TIMEZONES } from "@/server/modules/settings/settings";
import { storefrontUrl } from "@/server/tenancy/urls";
import { deleteShippingAction, saveSettingsAction, saveShippingAction } from "./actions";
import { SettingsForm, ShippingForm, ShippingRow } from "./forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/platform/dashboard/[store]/settings">) {
  const { store: subdomain } = await params;
  const { store, access, role } = await requireStoreRole(subdomain);
  const { settings, shipping } = await withTenant(store.storeId, async (tx) => ({
    settings: await getSettings(tx, store.storeId),
    shipping: await listShippingMethods(tx, store.storeId),
  }));
  // Settings need admin or owner; staff can look but not change.
  const readOnly = access.dashboard === "read_only" || !roleAtLeast(role, "admin");
  const money = (m: number) => formatMoney(m, settings.currency);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={
          <>
            Store address: <span className="font-mono">{storefrontUrl(settings.subdomain)}</span>
          </>
        }
      />
      {!roleAtLeast(role, "admin") && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm">Only the owner or an admin can change settings.</p>}

      <Card>
        <h2 className="mb-4 font-medium">Store details</h2>
        <SettingsForm
          action={saveSettingsAction.bind(null, subdomain)}
          initial={settings}
          currencies={SUPPORTED_CURRENCIES}
          timezones={TIMEZONES}
          readOnly={readOnly}
        />
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="font-medium">Delivery options</h2>
          <p className="text-sm text-muted">What customers can choose at checkout.</p>
        </div>
        {shipping.length === 0 && <p className="text-sm text-muted">No delivery options yet. Add one so customers can check out.</p>}
        <div className="space-y-2">
          {shipping.map((m) => (
            <ShippingRow
              key={m.id}
              readOnly={readOnly}
              states={NG_STATES}
              currency={settings.currency}
              initial={m}
              editAction={saveShippingAction.bind(null, subdomain, m.id)}
              deleteAction={deleteShippingAction.bind(null, subdomain, m.id)}
              summary={
                <div className="text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    {m.name} {!m.isActive && <Badge>hidden</Badge>}
                  </div>
                  <div className="text-muted">
                    {m.priceMinor === 0 ? "Free" : money(m.priceMinor)}
                    {m.freeOverMinor !== null && ` · free over ${money(m.freeOverMinor)}`}
                    {m.minDays !== null && m.maxDays !== null && ` · ${m.minDays}–${m.maxDays} days`}
                    {" · "}
                    {m.regions.length === 0 ? "All states" : m.regions.map((r) => NG_STATES[r] ?? r).join(", ")}
                  </div>
                </div>
              }
            />
          ))}
        </div>
        {!readOnly && (
          <div className="rounded-lg border border-dashed border-border p-4">
            <h3 className="mb-3 text-sm font-medium">Add a delivery option</h3>
            <ShippingForm action={saveShippingAction.bind(null, subdomain, null)} states={NG_STATES} currency={settings.currency} submitLabel="Add delivery option" />
          </div>
        )}
      </Card>
    </div>
  );
}
