"use client";

import Link from "next/link";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { keepValues } from "@/components/form";

type State = { ok: true; redirectTo?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> } | null;

const input = "mt-1 w-full rounded-lg border border-border px-3 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="w-full rounded-full bg-brand px-6 py-3 font-medium text-brand-foreground hover:opacity-90 disabled:opacity-50">
      {pending ? "Please wait…" : label}
    </button>
  );
}

/**
 * After signing in or out we do a full page load: the whole storefront (header,
 * cart, prices) depends on the session cookie. It happens inside the action
 * callback because the page re-renders with the new cookie in the same
 * response and may unmount this form before an effect could run.
 */
function followRedirect(state: State): State {
  if (state?.ok && state.redirectTo) window.location.assign(state.redirectTo);
  return state;
}

/** Store customer sign-in / registration (per-store accounts, not platform accounts). */
export function CustomerAuthForm({
  mode,
  action,
  next,
  switchHref,
}: {
  mode: "login" | "register";
  action: (s: State, f: FormData) => Promise<State>;
  /** Same-store path to return to; the server re-validates it. */
  next: string;
  switchHref: string;
}) {
  const [state, formAction] = useActionState(async (prev: State, data: FormData) => followRedirect(await action(prev, data)), null);
  const e = state && !state.ok ? state.fieldErrors ?? {} : {};
  const err = (k: string) => (e[k]?.[0] ? <span className="mt-1 block text-xs text-red-600">{e[k]![0]}</span> : null);

  return (
    <form action={formAction} {...keepValues} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {mode === "register" && (
        <label className="block text-sm">
          Your name
          <input name="name" required minLength={2} maxLength={120} autoComplete="name" className={input} />
          {err("name")}
        </label>
      )}
      <label className="block text-sm">
        Email
        <input name="email" type="email" required autoComplete="email" className={input} />
        {err("email")}
      </label>
      {mode === "register" && (
        <label className="block text-sm">
          Phone (optional)
          <input name="phone" type="tel" maxLength={30} autoComplete="tel" className={input} />
        </label>
      )}
      <label className="block text-sm">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={mode === "register" ? 8 : 1}
          maxLength={128}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          className={input}
        />
        {err("password")}
      </label>
      {state && !state.ok && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <Submit label={mode === "register" ? "Create account" : "Sign in"} />
      <p className="text-center text-sm text-muted">
        {mode === "register" ? "Already have an account? " : "New here? "}
        <Link href={switchHref} className="text-brand hover:underline">
          {mode === "register" ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}

/** Ends the customer session, then follows the action's redirect. */
export function CustomerLogoutButton({ action }: { action: () => Promise<State> }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          followRedirect(await action());
        })
      }
      className="rounded-full border border-border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
