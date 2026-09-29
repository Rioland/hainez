"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Follow `redirectTo` from a successful server action (client-side navigation).
 * Navigating to the URL we're already on becomes a refresh, so the page still
 * re-renders with fresh data.
 */
export function useActionRedirect(state: { ok: boolean; redirectTo?: string } | null) {
  const router = useRouter();
  useEffect(() => {
    if (!state?.ok || !state.redirectTo) return;
    const here = `${window.location.pathname}${window.location.search}`;
    if (here === state.redirectTo) router.refresh();
    else router.push(state.redirectTo);
  }, [state, router]);
}
