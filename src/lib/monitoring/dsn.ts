/**
 * DSN reading for configuration decisions.
 *
 * Pure and import-free on purpose: `next.config.ts` reaches this module through
 * `src/lib/security-headers.ts` to widen `connect-src`, and a config file
 * cannot resolve path aliases. Keeping the Sentry SDK out of this import path
 * also keeps it out of the ESLint, test, and verification runtimes that load
 * the header builder.
 *
 * This parses a URL; it implements none of Sentry's protocol. A DSN is a URL of
 * the form `https://<publicKey>@<host>/<projectId>`, and the browser SDK's
 * transport posts to `<origin>/api/<projectId>/envelope/`. The origin the
 * browser actually connects to is therefore exactly `new URL(dsn).origin`,
 * which was verified against the SDK's own endpoint builder
 * (`getEnvelopeEndpointWithUrlEncodedAuth`) rather than assumed.
 */

type EnvRecord = Record<string, string | undefined>;

/**
 * The configured DSN, or `null` when monitoring is not configured.
 *
 * One variable serves both runtimes. A DSN is public by design — every Sentry
 * browser SDK embeds it in the client bundle — so there is nothing to protect
 * by keeping a second, unprefixed copy, and a single value cannot drift.
 */
export function monitoringDsn(env: EnvRecord): string | null {
  const value = env.NEXT_PUBLIC_SENTRY_DSN?.trim();

  if (!value) return null;

  return sentryIngestOrigin(value) ? value : null;
}

/**
 * The origin the browser SDK sends events to, or `null` for a value that is not
 * a usable DSN. This is the only origin a Content-Security-Policy must allow;
 * server-side reporting is a Node request and needs no browser permission.
 */
export function sentryIngestOrigin(dsn: string | undefined | null): string | null {
  if (!dsn?.trim()) return null;

  try {
    const url = new URL(dsn.trim());

    // HTTPS only, matching the rule the analytics tracker already follows in
    // `src/lib/analytics/umami.ts`. A plaintext DSN would put an `http://`
    // origin into `connect-src`, which production's `upgrade-insecure-requests`
    // would then refuse to honour — a broken policy entry rather than a
    // working one. Refusing it disables monitoring instead, loudly enough to
    // notice and safely.
    if (url.protocol !== "https:") return null;

    // A DSN without a public key or a project id is a typo, not configuration.
    // Treating it as unconfigured avoids naming a junk origin in the policy.
    const projectId = url.pathname.replace(/^\/+/, "").replace(/\/+$/, "");

    if (!url.username || !/^\d+$/.test(projectId)) return null;

    return url.origin;
  } catch {
    return null;
  }
}
