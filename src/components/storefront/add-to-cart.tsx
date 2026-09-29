"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { formatMoney } from "@/lib/money";
import type { ProductOption } from "@/lib/variants";
import { keepValues } from "@/components/form";

type Variant = {
  id: string;
  optionValues: Record<string, string>;
  price: number;
  compareAt: number | null;
  available: boolean;
  maxQty: number;
  lowStock: boolean;
};
type State = { ok: true; message?: string } | { ok: false; error: string } | null;

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="flex-1 rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Adding…" : disabled ? "Sold out" : "Add to cart"}
    </button>
  );
}

/** Option picker (e.g. Size, Colour) + quantity + add to cart. */
export function AddToCart({
  options,
  variants,
  currency,
  cartHref,
  action,
}: {
  options: ProductOption[];
  variants: Variant[];
  currency: string;
  cartHref: string;
  action: (state: State, formData: FormData) => Promise<State>;
}) {
  const [state, formAction] = useActionState(action, null);
  const initial = variants.find((v) => v.available) ?? variants[0];
  const [selected, setSelected] = useState<Record<string, string>>(initial.optionValues);
  const [qty, setQty] = useState(1);

  const variant = useMemo(
    () => variants.find((v) => options.every((o) => v.optionValues[o.name] === selected[o.name])) ?? null,
    [variants, options, selected],
  );

  // Is there an in-stock variant with this value, given the other current choices?
  const valueAvailable = (optionName: string, value: string) =>
    variants.some(
      (v) => v.available && v.optionValues[optionName] === value && options.every((o) => o.name === optionName || v.optionValues[o.name] === selected[o.name]),
    );

  const maxQty = variant?.available ? variant.maxQty : 0;

  return (
    <form action={formAction} {...keepValues} className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-2xl font-semibold">{variant ? formatMoney(variant.price, currency) : "—"}</span>
        {variant?.compareAt && <span className="text-muted line-through">{formatMoney(variant.compareAt, currency)}</span>}
      </div>

      {options.map((o) => (
        <fieldset key={o.name}>
          <legend className="mb-2 text-sm font-medium">
            {o.name}: <span className="font-normal text-muted">{selected[o.name]}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {o.values.map((value) => {
              const active = selected[o.name] === value;
              const inStock = valueAvailable(o.name, value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setSelected((s) => ({ ...s, [o.name]: value }));
                    setQty(1);
                  }}
                  className={`min-w-12 rounded-lg border px-3 py-2 text-sm ${
                    active ? "border-foreground bg-foreground text-white" : "border-border hover:border-foreground"
                  } ${inStock ? "" : "text-muted line-through"}`}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <p className="text-sm">
        {!variant ? (
          <span className="text-muted">This combination isn&apos;t available.</span>
        ) : !variant.available ? (
          <span className="text-red-600">Sold out</span>
        ) : variant.lowStock ? (
          <span className="text-amber-700">Only {variant.maxQty} left</span>
        ) : (
          <span className="text-green-700">In stock</span>
        )}
      </p>

      <input type="hidden" name="variantId" value={variant?.id ?? ""} />
      <div className="flex gap-3">
        <label className="sr-only" htmlFor="qty">
          Quantity
        </label>
        <input
          id="qty"
          name="quantity"
          type="number"
          min={1}
          max={Math.max(1, maxQty)}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.min(Math.max(1, maxQty), Number(e.target.value) || 1)))}
          className="w-20 rounded-full border border-border px-4 py-3 text-center"
        />
        <SubmitButton disabled={!variant || !variant.available} />
      </div>

      {state?.ok && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          {state.message}{" "}
          <Link href={cartHref} className="font-medium underline">
            View cart
          </Link>
        </p>
      )}
      {state && !state.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
