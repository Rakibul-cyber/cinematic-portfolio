import type { Metadata } from "next";

/**
 * Admin shell.
 *
 * This layout intentionally carries no authorization logic. `/admin/login` must
 * render for unauthenticated visitors, so each admin page enforces its own
 * server-side requirement through the helpers in `src/server/auth/session.ts`.
 */
export const metadata: Metadata = {
  title: "Admin",
  // The admin area must never appear in search results.
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-background text-foreground">{children}</div>
  );
}
