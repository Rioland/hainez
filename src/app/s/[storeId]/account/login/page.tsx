import type { Metadata } from "next";
import { CustomerAuthPage } from "../auth-page";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ params, searchParams }: PageProps<"/s/[storeId]/account/login">) {
  const [{ storeId }, sp] = await Promise.all([params, searchParams]);
  return <CustomerAuthPage storeId={storeId} mode="login" next={sp.next} />;
}
