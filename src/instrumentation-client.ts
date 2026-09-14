import * as Sentry from "@sentry/nextjs";

import { sentryInitOptions } from "@/lib/monitoring/options";

/**
 * Sentry initialization for the browser.
 *
 * `instrumentation-client.ts` is the current Next.js entry point for
 * client-side instrumentation (Next.js 15.3+), and the SDK's documented
 * replacement for the older `sentry.client.config.ts`. Next.js runs it before
 * the application hydrates, which is what lets the SDK catch errors thrown
 * during the first render.
 *
 * The environment is assembled from individually named variables rather than
 * from `process.env` as a whole: only `NEXT_PUBLIC_*` values are inlined into
 * the browser bundle, so naming them is what makes the build substitute real
 * values — and it guarantees no server-only variable can be reached from here.
 *
 * `onRouterTransitionStart` is deliberately not exported. Its only purpose is
 * to open a navigation span, and tracing is off for this phase.
 */
const options = sentryInitOptions({
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  NEXT_PUBLIC_SENTRY_RELEASE: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
});

if (options) {
  Sentry.init(options);
}
