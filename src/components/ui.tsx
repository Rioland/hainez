import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* Minimal shared UI primitives. A fuller component set arrives with Stage 2. */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("mx-auto w-full max-w-6xl px-4 sm:px-6", className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-xl border border-border bg-white p-6 shadow-sm", className)} {...props} />;
}

const buttonBase =
  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60";
const variants = {
  primary: "bg-brand text-brand-foreground hover:opacity-90",
  secondary: "border border-border bg-white text-foreground hover:bg-slate-50",
  ghost: "text-foreground hover:bg-slate-100",
} as const;

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return <button className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof variants }) {
  return <Link className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700",
    good: "bg-green-100 text-green-800",
    warn: "bg-amber-100 text-amber-800",
    bad: "bg-red-100 text-red-800",
  };
  return <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function billingTone(status: string): "neutral" | "good" | "warn" | "bad" {
  if (status === "active") return "good";
  if (status === "trialing") return "neutral";
  if (status === "past_due") return "warn";
  return "bad";
}
