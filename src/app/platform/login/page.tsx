import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { safeNextPath } from "@/lib/safe-redirect";
import { getSession } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage({ searchParams }: PageProps<"/platform/login">) {
  const next = safeNextPath((await searchParams).next, "/dashboard");
  if (await getSession()) redirect(next);
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <AuthForm mode="login" title="Log in to your dashboard" next={next} switchHref="/signup" />
    </div>
  );
}
