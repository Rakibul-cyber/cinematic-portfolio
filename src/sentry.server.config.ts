import * as Sentry from "@sentry/nextjs";

import { sentryInitOptions } from "@/lib/monitoring/options";

/**
 * Sentry initialization for the Node.js server runtime.
 *
 * Loaded by `register()` in `src/instrumentation.ts`, which the SDK requires so
 * initialization happens before any application module runs.
 *
 * When monitoring is not configured, `Sentry.init` is not called at all —
 * rather than called with an empty DSN. No global error handler is installed,
 * no transport is created, and nothing can be sent.
 */
const options = sentryInitOptions(process.env);

if (options) {
  Sentry.init(options);
}
