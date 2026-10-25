"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { AdminErrorView } from "@/components/admin/admin-error-view";
import { reportBoundaryError } from "@/lib/monitoring/report";

/**
 * Admin error boundary.
 *
 * Catches failures in admin pages beneath the admin layout. Errors in the
 * admin layout itself, or anywhere above it, fall through to
 * `src/app/global-error.tsx`; route handlers (the CSV exports) answer with
 * their own responses and never reach a boundary. Redirects and `notFound()`
 * are framework control flow and are not caught here, so the login redirect
 * and the admin 404 keep working.
 *
 * "Try again" refreshes the server render as well as resetting the boundary,
 * because resetting alone would replay the same failed server result.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  useEffect(() => {
    console.error("[admin] Rendering failed:", error.digest ?? error.message);
    reportBoundaryError(error, "admin");
  }, [error]);

  return (
    <AdminErrorView
      digest={error.digest}
      onRetry={() =>
        startTransition(() => {
          router.refresh();
          reset();
        })
      }
      retrying={retrying}
    />
  );
}
