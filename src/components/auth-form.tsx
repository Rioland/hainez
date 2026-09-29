"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, Card } from "./ui";

type Props = {
  mode: "login" | "signup";
  /** Where to go after success (already validated as a same-site path). */
  next: string;
  /** Link to the other form ("Create an account" / "Log in"); omit to hide. */
  switchHref?: string;
  title: string;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

export function AuthForm({ mode, next, switchHref, title }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    const result =
      mode === "signup"
        ? await authClient.signUp.email({ name: String(form.get("name") ?? ""), email, password })
        : await authClient.signIn.email({ email, password });

    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Please try again.");
      setPending(false);
      return;
    }
    // Full navigation so server components see the new session cookie.
    window.location.assign(next);
  }

  return (
    <Card className="w-full max-w-sm">
      <h1 className="text-xl font-semibold">{title}</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {mode === "signup" && (
          <label className="block text-sm font-medium">
            Your name
            <input name="name" required minLength={2} maxLength={80} autoComplete="name" className={inputClass} />
          </label>
        )}
        <label className="block text-sm font-medium">
          Email
          <input name="email" type="email" required autoComplete="email" className={inputClass} />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input
            name="password"
            type="password"
            required
            minLength={8}
            maxLength={128}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className={inputClass}
          />
        </label>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
        </Button>
      </form>
      {switchHref && (
        <p className="mt-4 text-center text-sm text-muted">
          {mode === "signup" ? "Already have an account? " : "New here? "}
          <Link href={switchHref} className="font-medium text-brand hover:underline">
            {mode === "signup" ? "Log in" : "Create an account"}
          </Link>
        </p>
      )}
    </Card>
  );
}
