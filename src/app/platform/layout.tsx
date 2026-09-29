import type { Metadata } from "next";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { ButtonLink, Container } from "@/components/ui";
import { getSession } from "@/server/auth/guards";
import { env } from "@/server/env";

export const metadata: Metadata = {
  title: { default: env.PLATFORM_NAME, template: `%s · ${env.PLATFORM_NAME}` },
  description: "Launch your own online store in minutes. 30-day free trial.",
};

/** Platform surface: app.<root> (subdomain mode) or the root host (path mode). */
export default async function PlatformLayout({ children }: LayoutProps<"/platform">) {
  const session = await getSession();
  return (
    <>
      <header className="border-b border-border bg-white">
        <Container className="flex h-16 items-center justify-between">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {env.PLATFORM_NAME}
          </Link>
          <nav className="flex items-center gap-2">
            <Link href="/#pricing" className="hidden px-3 text-sm text-muted hover:text-foreground sm:block">
              Pricing
            </Link>
            {session ? (
              <>
                <ButtonLink href="/dashboard" variant="secondary">
                  Dashboard
                </ButtonLink>
                <SignOutButton redirectTo="/" />
              </>
            ) : (
              <>
                <ButtonLink href="/login" variant="ghost">
                  Log in
                </ButtonLink>
                <ButtonLink href="/signup">Start free trial</ButtonLink>
              </>
            )}
          </nav>
        </Container>
      </header>
      <main className="flex flex-1 flex-col bg-slate-50">{children}</main>
    </>
  );
}
