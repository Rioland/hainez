import type { Metadata } from "next";
import { CustomerAuthPage } from "../auth-page";

export const metadata: Metadata = { title: "Create account", robots: { index: false } };

export default async function RegisterPage({ params, searchParams }: PageProps<"/s/[storeId]/account/register">) {
  const [{ storeId }, sp] = await Promise.all([params, searchParams]);
  return <CustomerAuthPage storeId={storeId} mode="register" next={sp.next} />;
}
