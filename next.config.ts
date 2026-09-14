import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env) }];
  },
};

/**
 * Sentry build integration.
 *
 * The wrapper is applied unconditionally so a configured and an unconfigured
 * build produce the same output shape; whether anything is *sent* is decided at
 * runtime by the DSN, in `src/lib/monitoring/options.ts`.
 *
 * Source-map upload is switched off unless `SENTRY_AUTH_TOKEN` is present, so a
 * local build and a CI build without Sentry credentials never attempt an upload
 * and never emit a warning about the missing token. When a token is configured
 * — Phase 10, in the Netlify UI — maps are uploaded and then deleted from the
 * deployed bundle, so stack traces are readable in Sentry without publishing
 * this application's source to the internet.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },

  /**
   * Tree-shaking, because the SDK is bundled whether or not a DSN is
   * configured and this is an image-led site where First Load JS is felt.
   * Tracing and Session Replay are off (see `src/lib/monitoring/options.ts`),
   * so their code is dead weight in every bundle — including the Edge
   * middleware — and is removed at build time rather than merely unused.
   */
  webpack: {
    treeshake: {
      removeTracing: true,
      removeDebugLogging: true,
    },
  },
  bundleSizeOptimizations: {
    excludeTracing: true,
    excludeDebugStatements: true,
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
    excludeReplayWorker: true,
  },

  // Build-time diagnostics about this repository are not Sentry's to collect.
  telemetry: false,
  silent: !process.env.CI,
});
