import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

import { monitoringDsn } from "@/lib/monitoring/dsn";
import { scrubBreadcrumb, scrubEvent } from "@/lib/monitoring/scrub";

/**
 * The single Sentry configuration, shared by the browser, Node, and Edge
 * runtimes.
 *
 * Three `Sentry.init` call sites are required by the SDK — one per runtime —
 * and three independently written option objects would drift. Each config file
 * therefore spreads the object built here and adds nothing of its own, so a
 * privacy decision cannot end up applying to two runtimes out of three.
 *
 * Pure: the environment is passed in, so every decision below is assertable in
 * `npm test` without a DSN, a network, or a Sentry account.
 */

type EnvRecord = Record<string, string | undefined>;

/**
 * Integrations removed from the SDK defaults.
 *
 * `BrowserTracing` and the two session integrations are dropped rather than
 * merely left unsampled, so "tracing and session tracking are off" is a
 * structural fact rather than a sampling setting someone could flip. `Console`
 * and `LocalVariablesAsync` are the two Node defaults that would carry
 * application data into a report: this application logs the values it is
 * working with, and local variables at a throw site routinely hold an inquiry's
 * contents.
 *
 * Session Replay and profiling are not listed because they are never added —
 * the SDK includes neither by default, and nothing here opts in.
 */
export const DISABLED_INTEGRATIONS = [
  "BrowserTracing",
  "BrowserSession",
  "ProcessSession",
  "Console",
  "LocalVariables",
  "LocalVariablesAsync",
] as const;

export type MonitoringConfig = {
  dsn: string;
  environment: string;
  release?: string;
};

/**
 * Resolves monitoring configuration, or `null` when reporting is off.
 *
 * Reporting is enabled only in production, and only with a usable DSN. A
 * development stack trace belongs in the terminal the developer is already
 * watching; sending it to an error tracker adds noise that hides real
 * production failures. Neither state warns — running without monitoring is a
 * valid configuration, not a fault.
 */
export function resolveMonitoringConfig(env: EnvRecord): MonitoringConfig | null {
  if (env.NODE_ENV !== "production") return null;

  const dsn = monitoringDsn(env);

  if (!dsn) return null;

  return {
    dsn,
    environment: env.NEXT_PUBLIC_SENTRY_ENVIRONMENT?.trim() || "production",
    ...(env.NEXT_PUBLIC_SENTRY_RELEASE?.trim()
      ? { release: env.NEXT_PUBLIC_SENTRY_RELEASE.trim() }
      : {}),
  };
}

/**
 * Drops the integrations listed above from whatever the SDK defaults to.
 *
 * Generic over the integration shape so it satisfies the `integrations`
 * callback of all three runtimes without importing a type that
 * `@sentry/nextjs` does not re-export.
 */
export function filterIntegrations<T extends { name: string }>(
  defaults: T[],
): T[] {
  const disabled = new Set<string>(DISABLED_INTEGRATIONS);

  return defaults.filter((integration) => !disabled.has(integration.name));
}

/**
 * Options for `Sentry.init`, or `null` when monitoring is disabled.
 *
 * When this returns `null` the runtime config files call `Sentry.init` not at
 * all, so no global handler is installed, no transport is created, and no
 * request is ever made.
 */
export function sentryInitOptions(env: EnvRecord) {
  const config = resolveMonitoringConfig(env);

  if (!config) return null;

  return {
    dsn: config.dsn,
    environment: config.environment,
    ...(config.release ? { release: config.release } : {}),

    // Tracing is off: no `tracesSampleRate` and no `tracesSampler` are set, and
    // the tracing integration is removed below. Performance monitoring has no
    // Phase 9 requirement, and every span would be another network request
    // describing a visitor's navigation.
    integrations: filterIntegrations,

    /**
     * What the SDK is permitted to collect.
     *
     * Every field is stated explicitly and none is omitted. In v10 the defaults
     * that apply when `dataCollection` is present are the permissive ones, so a
     * partially specified object would silently collect *more* than leaving it
     * out — the opposite of the intent.
     *
     * This is what keeps the authenticated administrator's session cookie, the
     * Better Auth session, a visitor's IP, the Turnstile token, rate-limit
     * inputs, and inquiry form bodies out of every report.
     */
    dataCollection: {
      /** No IP address, no user id, no identity of any kind. */
      userInfo: false,
      /** Session and CSRF cookies never leave the process. */
      cookies: false,
      /** Excludes Authorization, Cookie, and the Turnstile token header. */
      httpHeaders: { request: false, response: false },
      /** An inquiry submission is a request body. Never collected. */
      httpBodies: [],
      /** Query strings carry submitted values. */
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      /** Query parameters and result rows from Prisma. */
      databaseQueryData: false,
      /**
       * The largest single risk: locals at a throw site inside the inquiry
       * workflow hold the visitor's name, address, phone, and message.
       */
      stackFrameVariables: false,
      /** Source context around a frame is this application's own code. */
      frameContextLines: 5,
    },

    /** Belt and braces over `dataCollection`; see `scrub.ts`. */
    beforeSend: (event: ErrorEvent) => scrubEvent(event),

    /**
     * Tracing is disabled, so no transaction should exist. If a future change
     * enables it, this makes that a deliberate act rather than an accident.
     */
    beforeSendTransaction: () => null,

    beforeBreadcrumb: (breadcrumb: Breadcrumb) => scrubBreadcrumb(breadcrumb),

    /** Aggregate discard statistics: another request, no diagnostic value. */
    sendClientReports: false,
  };
}
