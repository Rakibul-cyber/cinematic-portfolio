import * as Sentry from "@sentry/nextjs";

/**
 * Server instrumentation.
 *
 * `register()` is the hook Next.js calls once per server runtime, before any
 * application module loads. Only the Node.js runtime is initialized here.
 *
 * The Edge runtime deliberately is not. This application runs exactly one thing
 * on the Edge — the admin routing middleware — and it reads a cookie, redirects,
 * and sets a cache header, with no database, no network, and no parsing of
 * untrusted input beyond the cookie header. `src/middleware.ts` documents it as
 * routing convenience rather than an authorization control, and the real
 * authorization it stands in front of runs in the Node runtime, where
 * `onRequestError` already covers it.
 *
 * Initializing Sentry there cost 167 kB of generated edge instrumentation:
 * measured across two builds, the reported middleware bundle fell from 96.9 kB
 * to 41.5 kB and the whole edge bundle by 57%, with the client bundle
 * unchanged. That was loaded on every cold start of every `/admin` request to
 * watch twenty lines that cannot realistically fail, and a middleware crash
 * still surfaces in the host's own function logs. See ADR 0010.
 *
 * `onRequestError` is the framework's single hook for every error thrown while
 * rendering a Server Component, running a Server Action, or handling a Route
 * Handler request. Reporting through it means no failure path has to remember
 * to report and none reports twice. `Sentry.captureRequestError` is the SDK's
 * own handler for it.
 *
 * The hook receives the request headers, which carry the administrator's
 * session cookie. Those are never sent: `dataCollection` in
 * `src/lib/monitoring/options.ts` excludes headers and cookies outright, and
 * `beforeSend` deletes them from the event as a second pass.
 *
 * When monitoring is not configured the imported config calls `Sentry.init` not
 * at all, and `captureRequestError` becomes a no-op with no client to send to.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
