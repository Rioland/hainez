"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, Input, SubmitButton, Textarea, keepValues } from "@/components/form";
import { Button } from "@/components/ui";
import { ORDER_ACTION_LABEL, ORDER_TRANSITIONS, type OrderStatus } from "@/server/modules/orders/transitions";

type State = { ok: true; message?: string } | { ok: false; error: string } | null;

/** Buttons for the next allowed statuses; shipping asks for tracking, cancelling for a reason. */
export function OrderStatusControl({
  status,
  statusAction,
  noteAction,
  internalNote,
  inventoryCommitted,
  readOnly,
}: {
  status: OrderStatus;
  statusAction: (s: State, f: FormData) => Promise<State>;
  noteAction: (s: State, f: FormData) => Promise<State>;
  internalNote: string;
  /** Stock already taken for this order (storefront orders reserve it at checkout). */
  inventoryCommitted: boolean;
  readOnly?: boolean;
}) {
  const [state, formAction] = useActionState(statusAction, null);
  const [noteState, noteFormAction] = useActionState(noteAction, null);
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const next = ORDER_TRANSITIONS[status];

  return (
    <div className="space-y-4">
      {next.length === 0 ? (
        <p className="text-sm text-muted">This order is {status}. No further status changes.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {next.map((to) => (
            <Button
              key={to}
              type="button"
              variant={to === "cancelled" ? "secondary" : target === to ? "primary" : "secondary"}
              className={to === "cancelled" ? "text-red-600" : ""}
              disabled={readOnly}
              onClick={() => setTarget(to)}
            >
              {ORDER_ACTION_LABEL[to]}
            </Button>
          ))}
        </div>
      )}

      {target && (
        <form action={formAction} {...keepValues} className="space-y-3 rounded-lg border border-border bg-slate-50 p-3">
          <input type="hidden" name="to" value={target} />
          {target === "shipped" && (
            <Field label="Tracking number (optional)">
              <Input name="trackingNumber" maxLength={100} />
            </Field>
          )}
          <Field label={target === "cancelled" ? "Reason (optional)" : "Note (optional)"}>
            <Input name="note" maxLength={500} />
          </Field>
          {(target === "paid" || target === "shipped") && !inventoryCommitted && (
            <p className="text-xs text-muted">Stock for the items in this order will be deducted.</p>
          )}
          {target === "cancelled" && inventoryCommitted && <p className="text-xs text-muted">Stock will be returned to inventory.</p>}
          <div className="flex gap-2">
            <SubmitButton pendingText="Updating…">Confirm: {ORDER_ACTION_LABEL[target].toLowerCase()}</SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setTarget(null)}>
              Back
            </Button>
          </div>
        </form>
      )}
      <FormMessage state={state} />

      <form action={noteFormAction} {...keepValues} className="space-y-2 border-t border-border pt-4">
        <Field label="Internal note" hint="Only visible to your team">
          <Textarea name="note" defaultValue={internalNote} maxLength={2000} rows={3} disabled={readOnly} />
        </Field>
        <div className="flex items-center gap-3">
          <SubmitButton variant="secondary" disabled={readOnly}>
            Save note
          </SubmitButton>
          <FormMessage state={noteState} />
        </div>
      </form>
    </div>
  );
}
