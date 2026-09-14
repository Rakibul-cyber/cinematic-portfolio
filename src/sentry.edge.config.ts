import * as Sentry from "@sentry/nextjs";

import { sentryInitOptions } from "@/lib/monitoring/options";

/**
 * Sentry initialization for the Edge runtime.
 *
 * This application runs one thing on the Edge: the admin routing middleware
 * (see `src/middleware.ts`). It is a separate runtime with its own module
 * registry, so it needs its own `Sentry.init` — the Node configuration does not
 * reach it.
 *
 * Identical options to the server, from the same shared builder, so a privacy
 * decision cannot apply to one runtime and not the other.
 */
const options = sentryInitOptions(process.env);

if (options) {
  Sentry.init(options);
}
