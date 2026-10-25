"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

/**
 * Admin navigation link with loading feedback.
 *
 * Shows that the next admin page is on its way while its server render is
 * fetched. Deliberately not a `loading.tsx`: a route-level loading boundary
 * makes Next.js stream every admin response, which flushes a 200 status before
 * the page's `requireUser` / `notFound()` can answer, turning the login
 * redirect for a forged or expired session into a client-side refresh and every
 * admin 404 into a 200. This keeps those real HTTP answers and still gives
 * feedback on the navigations an administrator actually makes.
 */
export function AdminNavLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link className={className} href={href}>
      {children}
      <PendingIndicator />
    </Link>
  );
}

function PendingIndicator() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span aria-hidden="true" className={pending ? "ml-2 inline-block size-1.5 bg-accent align-middle motion-safe:animate-pulse" : "hidden"} />
      <span aria-live="polite" className="sr-only">
        {pending ? "Loading…" : ""}
      </span>
    </>
  );
}
