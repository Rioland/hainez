import { SignOutButton } from "@/components/sign-out-button";
import { Container } from "@/components/ui";
import { requireSuperAdmin } from "@/server/auth/guards";
import { env } from "@/server/env";
import { getBasePath } from "@/server/tenancy/request";

export default async function SuperadminLayout({ children }: LayoutProps<"/superadmin">) {
  const session = await requireSuperAdmin();
  const base = await getBasePath();
  return (
    <>
      <header className="bg-slate-900 text-white">
        <Container className="flex h-14 items-center justify-between">
          <span className="font-semibold">
            {env.PLATFORM_NAME} <span className="font-normal text-slate-400">super admin</span>
          </span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">{session.user.email}</span>
            <div className="[&_button]:text-white [&_button:hover]:bg-slate-800">
              <SignOutButton redirectTo={`${base}/login`} />
            </div>
          </div>
        </Container>
      </header>
      <main className="flex-1">{children}</main>
    </>
  );
}
