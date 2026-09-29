"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/money";
import type { CartLine } from "@/server/modules/storefront/cart";

type Result = { ok: true } | { ok: false; error: string } | null;

export function CartLines({
  lines,
  currency,
  base,
  update,
}: {
  lines: CartLine[];
  currency: string;
  base: string;
  update: (itemId: string, quantity: number) => Promise<Result>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const change = (itemId: string, quantity: number) =>
    start(async () => {
      setError(null);
      const res = await update(itemId, quantity);
      if (res && !res.ok) setError(res.error);
    });

  return (
    <div className={pending ? "opacity-60 transition" : "transition"}>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {lines.map((l) => (
          <li key={l.itemId} className="flex gap-4 p-4">
            <Link href={`${base}/p/${l.productSlug}`} className="size-20 shrink-0 overflow-hidden rounded-lg border border-border bg-slate-50">
              {l.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.imageUrl} alt={l.productTitle} className="h-full w-full object-cover" />
              )}
            </Link>
            <div className="flex flex-1 flex-col gap-1">
              <Link href={`${base}/p/${l.productSlug}`} className="font-medium hover:underline">
                {l.productTitle}
              </Link>
              {l.variantTitle && <span className="text-sm text-muted">{l.variantTitle}</span>}
              <span className="text-sm text-muted">{formatMoney(l.unitPrice, currency)} each</span>
              {l.issue === "unavailable" && <span className="text-sm text-red-600">No longer available — please remove it.</span>}
              {l.issue === "insufficient_stock" && <span className="text-sm text-amber-700">Only {l.maxQty} left — please lower the quantity.</span>}
              <div className="mt-1 flex items-center gap-2">
                <div className="flex items-center rounded-full border border-border">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    disabled={pending}
                    onClick={() => change(l.itemId, l.quantity - 1)}
                    className="px-3 py-1"
                  >
                    −
                  </button>
                  <span className="min-w-8 text-center text-sm" aria-label="Quantity">
                    {l.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    disabled={pending || l.quantity >= l.maxQty}
                    onClick={() => change(l.itemId, l.quantity + 1)}
                    className="px-3 py-1 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
                <button type="button" disabled={pending} onClick={() => change(l.itemId, 0)} className="text-sm text-muted hover:text-red-600">
                  Remove
                </button>
              </div>
            </div>
            <div className="text-right font-medium">{formatMoney(l.lineTotal, currency)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
