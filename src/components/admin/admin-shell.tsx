import type { ReactNode } from "react";
import { signOutAction } from "@/app/(admin)/admin/actions";
import { ADMIN_CONTENT_LINKS, adminLinksFor } from "@/components/admin/admin-links";
import { AdminMenu } from "@/components/admin/admin-menu";
import { AdminNavLink } from "@/components/admin/admin-nav-link";
export { Notice } from "@/components/admin/admin-notice";
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
    <>
      {/* First Tab stop, so keyboard users can pass the sidebar; uses the public site's skip-link style. */}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="mx-auto grid min-h-screen max-w-7xl md:grid-cols-[14rem_1fr]">
        <aside className="border-b border-border p-5 md:border-r md:border-b-0">
          <AdminMenu
            header={
              <div>
                <p className="font-display text-xl">Studio CMS</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {user.name} · {user.role}
                </p>
              </div>
            }
          >
            <nav
              aria-label="Admin"
              className="mt-6 grid grid-cols-2 gap-1 md:grid-cols-1"
            >
              {adminLinksFor(user.role).map(({ label, href }) => (
                <AdminNavLink
                  className="min-h-10 border-l-2 border-transparent px-3 py-2 text-sm hover:bg-surface-strong [&[aria-current]]:border-accent [&[aria-current]]:bg-surface-strong"
                  href={href}
                  key={href}
                >
                  {label}
                </AdminNavLink>
              ))}
              {/* Secondary group: rarely edited, so quieter and below the six everyday links. */}
              <p className="col-span-full mt-5 px-3 text-[0.6875rem] tracking-wider text-muted-foreground uppercase">
                Website content
              </p>
              {ADMIN_CONTENT_LINKS.map(({ label, href }) => (
                <AdminNavLink
                  className="min-h-10 border-l-2 border-transparent px-3 py-2 text-xs text-muted-foreground hover:bg-surface-strong hover:text-foreground [&[aria-current]]:border-accent [&[aria-current]]:bg-surface-strong [&[aria-current]]:text-foreground"
                  href={href}
                  key={href}
                >
                  {label}
                </AdminNavLink>
              ))}
            </nav>
            <form action={signOutAction} className="mt-6">
              <button className="inline-flex min-h-10 items-center text-sm underline">Sign out</button>
            </form>
          </AdminMenu>
        </aside>
        {/* Focusable only as the skip link's target, so focus lands inside it rather than staying on the link. */}
        <main id="main-content" className="min-w-0 p-5 focus:outline-none sm:p-8" tabIndex={-1}>
          <h1 className="mb-8 font-display text-4xl">{title}</h1>
          {children}
        </main>
      </div>
    </>
  );
}
export { areaClass, buttonClass, inputClass } from "@/components/admin/admin-styles";
