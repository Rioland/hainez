"use client";

import { useRouter } from "next/navigation";
import { useTransition, useState } from "react";
import { Button } from "@/components/ui";

type Result = { ok: true; redirectTo?: string } | { ok: false; error: string } | null;

/** Destructive action with a confirmation step (no browser dialogs). */
export function DeleteButton({ action, label = "Delete", confirmText = "Are you sure? This can't be undone." }: { action: () => Promise<Result>; label?: string; confirmText?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!confirming) {
    return (
      <Button type="button" variant="secondary" className="text-red-600" onClick={() => setConfirming(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm">
      <span className="text-red-800">{confirmText}</span>
      <Button
        type="button"
        className="bg-red-600 text-white"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await action();
            if (res && !res.ok) setError(res.error);
            else if (res?.ok && res.redirectTo) router.push(res.redirectTo);
            else router.refresh();
          })
        }
      >
        {pending ? "Deleting…" : "Yes, delete"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      {error && <span className="text-red-700">{error}</span>}
    </div>
  );
}
