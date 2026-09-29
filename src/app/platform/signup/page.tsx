import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSession } from "@/server/auth/guards";

export const metadata: Metadata = { title: "Start your free trial" };

// Stage 1: account only. Stage 5 adds store name + subdomain and starts the trial.
export default async function SignupPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <AuthForm mode="signup" title="Create your account" next="/dashboard" switchHref="/login" />
    </div>
  );
}
