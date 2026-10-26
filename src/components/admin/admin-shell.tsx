import type { ReactNode } from "react";
import { signOutAction } from "@/app/(admin)/admin/actions";
import { adminLinksFor } from "@/components/admin/admin-links";
import { AdminNavLink } from "@/components/admin/admin-nav-link";
import type { AdminUser } from "@/server/auth/session";

export function AdminShell({
  user,
  title,
  children,
}: {
  user: AdminUser;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid min-h-screen max-w-7xl md:grid-cols-[14rem_1fr]">
      <aside className="border-b border-border p-5 md:border-r md:border-b-0">
        <p className="font-display text-xl">Studio CMS</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {user.name} · {user.role}
        </p>
        <nav
          aria-label="Admin"
          className="mt-6 grid grid-cols-2 gap-1 md:grid-cols-1"
        >
          {adminLinksFor(user.role).map(({ label, href }) => (
            <AdminNavLink
              className="min-h-10 px-3 py-2 text-sm hover:bg-surface-strong"
              href={href}
              key={href}
            >
              {label}
            </AdminNavLink>
          ))}
        </nav>
        <form action={signOutAction} className="mt-6">
          <button className="text-sm underline">Sign out</button>
        </form>
      </aside>
      <main id="main-content" className="min-w-0 p-5 sm:p-8">
        <h1 className="mb-8 font-display text-4xl">{title}</h1>
        {children}
      </main>
    </div>
  );
}
export function Notice({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mb-5 border border-accent p-3 text-sm">
      {message}
    </p>
  ) : null;
}
export { areaClass, buttonClass, inputClass } from "@/components/admin/admin-styles";
