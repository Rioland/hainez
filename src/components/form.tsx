"use client";

import type { ComponentProps, FormEvent, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "./ui";

/* Form primitives shared by dashboard forms. */

/**
 * React 19 resets a <form action={...}> after every submission, which wipes
 * what the user typed when the server answers with a validation error. Spread
 * onto such forms to keep the values: <form action={a} {...keepValues}>.
 * To clear a form on purpose (e.g. after "Add"), call clearForm(form).
 */
export const keepValues = {
  onReset: (e: FormEvent<HTMLFormElement>) => {
    if (e.currentTarget.dataset.clearing !== "1") e.preventDefault();
  },
};

export function clearForm(form: HTMLFormElement | null) {
  if (!form) return;
  form.dataset.clearing = "1";
  form.reset(); // fires "reset" synchronously
  delete form.dataset.clearing;
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const inputClass =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:bg-slate-50 disabled:text-muted";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string[] | string;
  children: ReactNode;
  className?: string;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <label className={cx("block text-sm", className)}>
      <span className="font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {message ? <span className="mt-1 block text-xs text-red-600">{message}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputClass, "min-h-24", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(inputClass, "pr-8", className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cx("inline-flex items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="size-4 rounded border-border accent-[var(--brand-primary)]" {...props} />
      {label}
    </label>
  );
}

/** Currency-prefixed amount input (value in major units, e.g. "15000.00"). */
export function MoneyInput({ currency = "NGN", className, ...props }: ComponentProps<"input"> & { currency?: string }) {
  const symbol = { NGN: "₦", GHS: "GH₵", KES: "KSh", ZAR: "R", USD: "$" }[currency] ?? currency;
  return (
    <div className={cx("flex items-center rounded-lg border border-border bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20", className)}>
      <span className="pl-3 text-sm text-muted">{symbol}</span>
      <input inputMode="decimal" className="w-full rounded-lg bg-transparent px-2 py-2 text-sm outline-none" {...props} />
    </div>
  );
}

export function SubmitButton({ children, pendingText = "Saving…", ...props }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: { ok: boolean; error?: string; message?: string } | null }) {
  if (!state) return null;
  if (state.ok) return state.message ? <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{state.message}</p> : null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {state.error}
    </p>
  );
}
