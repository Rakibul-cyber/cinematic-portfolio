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
 *
 * `NODE_ENV` is written as the literal `process.env.NODE_ENV`, which the
 * production build replaces with "production". Read through the `process.env`
 * object instead, it would be whatever the deployed function sees at runtime,
 * and a host that leaves it unset or sets another value would silently switch
 * server reporting off (DEF-02). The DSN, environment, and release labels are
 * still read from the runtime environment, as before.
 */
const options = sentryInitOptions({ ...process.env, NODE_ENV: process.env.NODE_ENV });

if (options) {
  Sentry.init(options);
}
