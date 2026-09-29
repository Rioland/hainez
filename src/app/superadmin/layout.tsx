import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Super admin", template: "%s · Super admin" },
  robots: { index: false, follow: false },
};

/** Super-admin surface: admin.<root> (subdomain mode) or /admin (path mode). */
export default function SuperadminRootLayout({ children }: LayoutProps<"/superadmin">) {
  return <div className="flex min-h-full flex-1 flex-col bg-slate-100">{children}</div>;
}
