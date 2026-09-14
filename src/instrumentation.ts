import * as Sentry from "@sentry/nextjs";

/**
 * Server instrumentation.
 *
 * `register()` is the hook Next.js calls once per server runtime, before any
 * application module loads. Each runtime has its own module registry, so the
 * Node and Edge configurations are imported separately and only when that
 * runtime is the one starting.
 *
 * `onRequestError` is the framework's single hook for every error thrown while
 * rendering a Server Component, running a Server Action, handling a Route
 * Handler request, or executing middleware. Reporting through it means no
 * failure path has to remember to report and none reports twice.
 * `Sentry.captureRequestError` is the SDK's own handler for it.
 *
 * The hook receives the request headers, which carry the administrator's
 * session cookie. Those are never sent: `dataCollection` in
 * `src/lib/monitoring/options.ts` excludes headers and cookies outright, and
 * `beforeSend` deletes them from the event as a second pass.
 *
 * When monitoring is not configured the imported config files call
 * `Sentry.init` not at all, and `captureRequestError` becomes a no-op with no
 * client to send to.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
