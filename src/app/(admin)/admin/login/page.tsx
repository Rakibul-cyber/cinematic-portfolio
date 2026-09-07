import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/app/(admin)/admin/login/login-form";
import { siteContent } from "@/content/site";
import { ADMIN_ROOT_PATH, isSafeInternalPath } from "@/lib/admin-routes";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false, nocache: true },
};

// Reads the session cookie on every request.
export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const requestedNext = typeof params.next === "string" ? params.next : undefined;

  // Only same-origin admin paths are accepted, so a crafted `next` value cannot
  // turn the login page into an open redirect.
  const redirectTo = isSafeInternalPath(requestedNext)
    ? (requestedNext as string)
    : ADMIN_ROOT_PATH;

  // An already-authenticated administrator has no reason to see this page.
  const user = await getCurrentUser();

  if (user) {
    redirect(redirectTo);
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center px-5 py-12"
      id="main-content"
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-3 border-b border-border pb-8 text-center">
          <p className="font-display text-2xl tracking-[0.14em] uppercase">
            {siteContent.brand.name}
          </p>
          <h1 className="text-[0.7rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Studio administration
          </h1>
        </div>

        <div className="pt-8">
          <LoginForm redirectTo={redirectTo} />
        </div>

        <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
          Access is limited to studio administrators. Accounts are created by an
          administrator; there is no self-registration.
        </p>
      </div>
    </main>
  );
}
