"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "./ui";

export function SignOutButton({ redirectTo }: { redirectTo: string }) {
  return (
    <Button
      variant="ghost"
      onClick={async () => {
        await authClient.signOut();
        window.location.assign(redirectTo);
      }}
    >
      Sign out
    </Button>
  );
}
