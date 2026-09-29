"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Checkbox, Field, FormMessage, Input, MoneyInput, Select, SubmitButton, clearForm, keepValues } from "@/components/form";
import { Button } from "@/components/ui";
import { minorToInput } from "@/lib/money";

type State = { ok: true; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> } | null;
type Action = (s: State, f: FormData) => Promise<State>;

export function SettingsForm({
  action,
  initial,
  currencies,
  timezones,
  readOnly,
}: {
  action: Action;
  initial: {
    name: string;
    contactEmail: string | null;
    contactPhone: string | null;
    currency: string;
    timezone: string;
    address: Record<string, string | null>;
  };
  currencies: readonly string[];
  timezones: readonly string[];
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const e = state && !state.ok ? state.fieldErrors ?? {} : {};
  const [currency, setCurrency] = useState(initial.currency);

  return (
    <form action={formAction} {...keepValues} className="space-y-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field label="Store name" error={e.name}>
          <Input name="name" defaultValue={initial.name} required minLength={2} maxLength={80} />
        </Field>
        <Field label="Contact email" error={e.contactEmail}>
          <Input name="contactEmail" type="email" defaultValue={initial.contactEmail ?? ""} />
        </Field>
        <Field label="Contact phone" error={e.contactPhone}>
          <Input name="contactPhone" type="tel" defaultValue={initial.contactPhone ?? ""} />
        </Field>
        <Field
          label="Currency"
          error={e.currency}
          hint={currency !== initial.currency ? "Existing prices are not converted; update them after changing currency." : undefined}
        >
          <Select name="currency" value={currency} onChange={(ev) => setCurrency(ev.target.value)}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Time zone" error={e.timezone}>
          <Select name="timezone" defaultValue={initial.timezone}>
            {timezones.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <div />
        <Field label="Address line 1">
          <Input name="line1" defaultValue={initial.address.line1 ?? ""} maxLength={200} />
        </Field>
        <Field label="Address line 2">
          <Input name="line2" defaultValue={initial.address.line2 ?? ""} maxLength={200} />
        </Field>
        <Field label="City">
          <Input name="city" defaultValue={initial.address.city ?? ""} maxLength={100} />
        </Field>
        <Field label="State">
          <Input name="state" defaultValue={initial.address.state ?? ""} maxLength={100} />
        </Field>
        <input type="hidden" name="country" value={initial.address.country ?? "NG"} />
      </fieldset>
      <div className="flex items-center gap-3">
        <SubmitButton disabled={readOnly}>Save settings</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export type ShippingValues = {
  name: string;
  description: string | null;
  priceMinor: number;
  freeOverMinor: number | null;
  regions: string[];
  minDays: number | null;
  maxDays: number | null;
  isActive: boolean;
};

export function ShippingForm({
  action,
  initial,
  states,
  currency,
  submitLabel,
  onDone,
  readOnly,
}: {
  action: Action;
  initial?: ShippingValues;
  states: Record<string, string>;
  currency: string;
  submitLabel: string;
  onDone?: () => void;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const e = state && !state.ok ? state.fieldErrors ?? {} : {};
  const [everywhere, setEverywhere] = useState(!initial || initial.regions.length === 0);

  useEffect(() => {
    if (state?.ok) {
      if (!initial) clearForm(ref.current);
      onDone?.();
    }
  }, [state, initial, onDone]);

  return (
    <form ref={ref} action={formAction} {...keepValues} className="space-y-4">
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={e.name}>
          <Input name="name" required maxLength={80} defaultValue={initial?.name} placeholder="e.g. Lagos delivery" />
        </Field>
        <Field label="Description" error={e.description}>
          <Input name="description" maxLength={300} defaultValue={initial?.description ?? ""} placeholder="Optional" />
        </Field>
        <Field label="Price" error={e.price ?? e.priceMinor}>
          <MoneyInput currency={currency} name="price" required defaultValue={minorToInput(initial?.priceMinor ?? 0)} />
        </Field>
        <Field label="Free when order is over" hint="Optional" error={e.freeOver ?? e.freeOverMinor}>
          <MoneyInput currency={currency} name="freeOver" defaultValue={minorToInput(initial?.freeOverMinor)} />
        </Field>
        <Field label="Delivery time (days)" error={e.maxDays}>
          <div className="flex items-center gap-2">
            <Input name="minDays" type="number" min={0} max={90} defaultValue={initial?.minDays ?? ""} placeholder="min" />
            <span className="text-muted">to</span>
            <Input name="maxDays" type="number" min={0} max={90} defaultValue={initial?.maxDays ?? ""} placeholder="max" />
          </div>
        </Field>
        <div className="flex items-end">
          <Checkbox name="isActive" label="Offer at checkout" defaultChecked={initial?.isActive ?? true} />
        </div>
        <div className="sm:col-span-2">
          <Checkbox label="Deliver to all states" checked={everywhere} onChange={(ev) => setEverywhere(ev.target.checked)} />
          {!everywhere && (
            <div className="mt-2 grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-4">
              {Object.entries(states).map(([code, name]) => (
                <Checkbox key={code} name="regions" value={code} label={name} defaultChecked={initial?.regions.includes(code)} />
              ))}
            </div>
          )}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <SubmitButton disabled={readOnly}>{submitLabel}</SubmitButton>
        {onDone && initial && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
        <FormMessage state={state} />
      </div>
    </form>
  );
}

/** A shipping method row that turns into its edit form. */
export function ShippingRow({
  summary,
  editAction,
  deleteAction,
  initial,
  states,
  currency,
  readOnly,
}: {
  summary: React.ReactNode;
  editAction: Action;
  deleteAction: () => Promise<State>;
  initial: ShippingValues;
  states: Record<string, string>;
  currency: string;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (editing) {
    return (
      <div className="rounded-lg border border-border p-4">
        <ShippingForm action={editAction} initial={initial} states={states} currency={currency} submitLabel="Save" onDone={() => setEditing(false)} />
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
      <div>{summary}</div>
      {!readOnly && (
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {confirming ? (
            <Button type="button" className="bg-red-600 text-white" onClick={() => deleteAction()}>
              Confirm delete
            </Button>
          ) : (
            <Button type="button" variant="ghost" className="text-red-600" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
