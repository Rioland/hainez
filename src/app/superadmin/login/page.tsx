import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { safeNextPath } from "@/lib/safe-redirect";
import { getSession } from "@/server/auth/guards";
import { getBasePath } from "@/server/tenancy/request";

export const metadata: Metadata = { title: "Log in" };

// Separate login on the admin surface: sessions are host-only cookies, so the
// super admin signs in here rather than reusing the app. session.
export default async function SuperadminLoginPage({ searchParams }: PageProps<"/superadmin/login">) {
  const base = await getBasePath();
  const home = base || "/";
  const next = safeNextPath((await searchParams).next, home);
  if (await getSession()) redirect(next);
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <AuthForm mode="login" title="Super admin" next={next} />
    </div>
  );
}
