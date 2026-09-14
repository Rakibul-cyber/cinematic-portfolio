import * as Sentry from "@sentry/nextjs";

/**
 * The application's reporting call site for React error boundaries.
 *
 * A thin wrapper over `Sentry.captureException`, not a transport: it exists so
 * the boundaries share one decision about *what not to report*, and so that
 * decision is testable without a Sentry account.
 *
 * That decision is double-report avoidance. An error thrown on the server is
 * already captured by `onRequestError` in `src/instrumentation.ts`, complete
 * with its real stack. Next.js then re-renders the boundary in the browser with
 * a redacted placeholder error carrying only a `digest`. Reporting that too
 * would file a second, less useful issue for the same failure — so a digest is
 * treated as "already reported on the server" and skipped.
 *
 * Errors without a digest are genuine client-side failures that no server hook
 * saw, and those are reported.
 *
 * When monitoring is not configured, no Sentry client exists and this is a
 * no-op that makes no request.
 */
export function reportBoundaryError(
  error: Error & { digest?: string },
  boundary: "public" | "global",
): void {
  if (error.digest) return;

  Sentry.captureException(error, { tags: { boundary } });
}
