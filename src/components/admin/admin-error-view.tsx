"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { buttonClass } from "@/components/admin/admin-styles";

/**
 * What an administrator sees when an admin page fails to render.
 *
 * It is given the error's `digest` and nothing else, so no message, stack,
 * query or token can reach the screen. In production Next.js already replaces
 * a server error with a digest-only placeholder; this keeps the same guarantee
 * in development and for errors thrown in the browser.
 *
 * A role denial (`AuthorizationError`) arrives here too, indistinguishable from
 * a failure once redacted, so the copy covers both honestly. Focus moves to
 * the heading so the change is announced without a live region.
 */
export function AdminErrorView({ digest, onRetry, retrying }: { digest?: string; onRetry: () => void; retrying: boolean }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="mx-auto max-w-3xl p-5 sm:p-8" id="main-content">
      <p className="text-xs tracking-wider text-muted-foreground uppercase">Studio CMS</p>
      <h1 className="mt-3 font-display text-4xl" ref={headingRef} tabIndex={-1}>
        This page could not be shown
      </h1>
      <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
        An unexpected problem stopped this admin page from loading, or your account may not have access to it. You can try again, or return to the dashboard.
      </p>
      {digest ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Reference: <code className="text-foreground">{digest}</code> — include it if you report the problem.
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button className={buttonClass} disabled={retrying} onClick={onRetry} type="button">
          {retrying ? "Trying again…" : "Try again"}
        </button>
        {/* Navigating away resets the boundary; "Try again" covers the dashboard itself failing. */}
        <Link className="text-sm underline underline-offset-4" href="/admin">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
