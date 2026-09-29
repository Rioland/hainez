"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { deliveryPrice, methodCoversState } from "@/lib/availability";
import { formatMoney } from "@/lib/money";
import { keepValues } from "@/components/form";

type State = { ok: true; redirectTo?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> } | null;
type Delivery = {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number;
  freeOverMinor: number | null;
  regions: string[];
  minDays: number | null;
  maxDays: number | null;
};

const input = "mt-1 w-full rounded-lg border border-border px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

function Place({ total, disabled, placed }: { total: string; disabled: boolean; placed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled || placed}
      className="w-full rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50"
    >
      {placed ? "Order placed…" : pending ? "Placing order…" : `Place order · ${total}`}
    </button>
  );
}

export function CheckoutForm({
  action,
  states,
  deliveries,
  subtotal,
  currency,
  customer,
}: {
  action: (s: State, f: FormData) => Promise<State>;
  states: Record<string, string>;
  deliveries: Delivery[];
  subtotal: number;
  currency: string;
  customer: { email: string; name: string | null; phone: string | null } | null;
}) {
  // On success: full page load of the confirmation page, so the header (cart
  // count) is fresh. Done in the action callback, not an effect, so it can't be
  // lost if the page re-renders first.
  const [state, formAction] = useActionState(async (prev: State, data: FormData) => {
    const result = await action(prev, data);
    if (result?.ok && result.redirectTo) window.location.assign(result.redirectTo);
    return result;
  }, null);
  const placed = Boolean(state?.ok && state.redirectTo);
  const e = state && !state.ok ? state.fieldErrors ?? {} : {};
  const [stateCode, setStateCode] = useState("");
  const [deliveryId, setDeliveryId] = useState("");

  const available = useMemo(() => (stateCode ? deliveries.filter((d) => methodCoversState(d.regions, stateCode)) : []), [deliveries, stateCode]);
  const chosen = available.find((d) => d.id === deliveryId) ?? null;
  const delivery = chosen ? deliveryPrice(chosen, subtotal) : 0;
  const money = (m: number) => formatMoney(m, currency);
  const err = (k: string) => (e[k]?.[0] ? <span className="mt-1 block text-xs text-red-600">{e[k]![0]}</span> : null);

  return (
    <form action={formAction} {...keepValues} className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-lg font-semibold">Contact</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              Email
              <input name="email" type="email" required autoComplete="email" defaultValue={customer?.email} readOnly={Boolean(customer)} className={input} />
              {err("email")}
            </label>
            <label className="text-sm">
              Phone
              <input name="phone" type="tel" required autoComplete="tel" defaultValue={customer?.phone ?? ""} placeholder="0803 123 4567" className={input} />
              {err("phone")}
            </label>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Delivery address</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              Full name
              <input name="fullName" required autoComplete="name" defaultValue={customer?.name ?? ""} className={input} />
              {err("fullName")}
            </label>
            <label className="text-sm sm:col-span-2">
              Street address
              <input name="line1" required autoComplete="address-line1" className={input} />
              {err("line1")}
            </label>
            <label className="text-sm sm:col-span-2">
              Apartment, landmark (optional)
              <input name="line2" autoComplete="address-line2" className={input} />
            </label>
            <label className="text-sm">
              City / town
              <input name="city" required autoComplete="address-level2" className={input} />
              {err("city")}
            </label>
            <label className="text-sm">
              State
              <select
                name="state"
                required
                value={stateCode}
                onChange={(ev) => {
                  setStateCode(ev.target.value);
                  setDeliveryId("");
                }}
                className={input}
              >
                <option value="">Choose…</option>
                {Object.entries(states).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
              {err("state")}
            </label>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Delivery</h2>
          {!stateCode ? (
            <p className="text-sm text-muted">Choose your state to see delivery options.</p>
          ) : available.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Sorry, we don&apos;t deliver to {states[stateCode]} yet.</p>
          ) : (
            <div className="space-y-2">
              {available.map((d) => (
                <label key={d.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${deliveryId === d.id ? "border-brand bg-brand/5" : "border-border"}`}>
                  <input type="radio" name="deliveryId" value={d.id} checked={deliveryId === d.id} onChange={() => setDeliveryId(d.id)} className="mt-1" />
                  <span className="flex-1">
                    <span className="font-medium">{d.name}</span>
                    <span className="block text-sm text-muted">
                      {[d.description, d.minDays !== null && d.maxDays !== null ? `${d.minDays}–${d.maxDays} days` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="font-medium">{deliveryPrice(d, subtotal) === 0 ? "Free" : money(deliveryPrice(d, subtotal))}</span>
                </label>
              ))}
            </div>
          )}
          {err("deliveryId")}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Payment</h2>
          <label className="flex items-start gap-3 rounded-xl border border-brand bg-brand/5 p-4">
            <input type="radio" name="paymentMethod" value="pay_on_delivery" defaultChecked className="mt-1" />
            <span>
              <span className="font-medium">Pay on delivery</span>
              <span className="block text-sm text-muted">Pay when your order arrives. Online card payment is coming soon.</span>
            </span>
          </label>
          <label className="mt-4 block text-sm">
            Order note (optional)
            <textarea name="note" rows={2} maxLength={1000} className={input} placeholder="Delivery instructions, gift message…" />
          </label>
        </section>
      </div>

      <aside className="h-fit space-y-3 rounded-2xl border border-border p-6 lg:sticky lg:top-24">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Subtotal</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted">Delivery</span>
          <span>{chosen ? (delivery === 0 ? "Free" : money(delivery)) : "—"}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-3 text-lg font-semibold">
          <span>Total</span>
          <span>{money(subtotal + delivery)}</span>
        </div>
        {state && !state.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
        <Place total={money(subtotal + delivery)} disabled={!chosen} placed={placed} />
      </aside>
    </form>
  );
}
