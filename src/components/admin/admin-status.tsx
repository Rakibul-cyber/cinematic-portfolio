import { AdminNavLink } from "@/components/admin/admin-nav-link";

/**
 * Admin not-found screen.
 *
 * Receives and shows nothing about the signed-in user, so it is safe in front
 * of anyone who reached it; every route that can render it checks the session
 * first.
 */

const SHORTCUTS = [
  ["Dashboard", "/admin"],
  ["Inquiries", "/admin/inquiries"],
  ["Projects", "/admin/projects"],
  ["Media", "/admin/media"],
] as const;

export function AdminNotFoundView() {
  return (
    <main className="mx-auto max-w-3xl p-5 sm:p-8" id="main-content">
      <p className="text-xs tracking-wider text-muted-foreground uppercase">Studio CMS</p>
      <h1 className="mt-3 font-display text-4xl">Page not found</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
        This admin page does not exist, or the item you were looking for may have been deleted.
      </p>
      <nav aria-label="Admin shortcuts" className="mt-8">
        <ul className="flex flex-wrap gap-2">
          {SHORTCUTS.map(([label, href]) => (
            <li key={href}>
              <AdminNavLink className="inline-flex min-h-10 items-center border border-border px-4 text-sm hover:border-foreground" href={href}>
                {label}
              </AdminNavLink>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}

/** Safe 403 screen: no exception, user, query, or protected data is accepted. */
export function AdminForbiddenView() {
  return (
    <main className="mx-auto max-w-3xl p-5 sm:p-8" id="main-content">
      <p className="text-xs tracking-wider text-muted-foreground uppercase">Studio CMS</p>
      <h1 className="mt-3 font-display text-4xl">Access denied</h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
        Your account does not have permission to view this admin page.
      </p>
      <AdminNavLink
        className="mt-8 inline-flex min-h-10 items-center border border-border px-4 text-sm hover:border-foreground"
        href="/admin"
      >
        Back to dashboard
      </AdminNavLink>
    </main>
  );
}
