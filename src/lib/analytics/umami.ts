/**
 * Umami analytics configuration.
 *
 * Pure and import-free on purpose: `next.config.ts` reaches this module through
 * `src/lib/security-headers.ts` to widen the Content-Security-Policy for the
 * configured tracker origin, and a config file cannot resolve path aliases or
 * server-only modules.
 *
 * Analytics is optional. When it is not configured — the normal state locally
 * and in any deployment that has not opted in — this reports "disabled" and no
 * script, request, or cookie exists. Nothing warns, because absent analytics is
 * a valid configuration rather than a fault.
 *
 * Umami is cookieless and stores no personal data in the browser, which is why
 * it needs no consent banner (see ADR 0009). Nothing in this repository writes
 * a cookie for analytics.
 */

/** Stable element id, so the tracker can only ever be mounted once. */
export const UMAMI_SCRIPT_ID = "umami-analytics";

/** Umami Cloud's tracker. A self-hosted instance overrides it by URL. */
export const DEFAULT_UMAMI_SCRIPT_URL = "https://cloud.umami.is/script.js";

export type UmamiConfig = {
  websiteId: string;
  scriptUrl: string;
  /** Origin the tracker is served from and reports to, for the CSP. */
  scriptOrigin: string;
};

type EnvRecord = Record<string, string | undefined>;

/**
 * Resolves analytics configuration, or `null` when analytics is disabled.
 *
 * The website id is public by nature — it is an attribute on a script tag — so
 * `NEXT_PUBLIC_UMAMI_WEBSITE_ID` is the canonical name. `UMAMI_WEBSITE_ID` is
 * accepted as an alias for deployments that configure it without the prefix;
 * it is read on the server, where the tracker tag is rendered.
 *
 * A malformed or non-HTTPS script URL disables analytics rather than emitting
 * a broken tag.
 */
export function resolveUmamiConfig(env: EnvRecord): UmamiConfig | null {
  const websiteId =
    env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim() || env.UMAMI_WEBSITE_ID?.trim();

  if (!websiteId) return null;

  const scriptUrl =
    env.NEXT_PUBLIC_UMAMI_SCRIPT_URL?.trim() || DEFAULT_UMAMI_SCRIPT_URL;

  try {
    const url = new URL(scriptUrl);

    if (url.protocol !== "https:") return null;

    return { websiteId, scriptUrl: url.toString(), scriptOrigin: url.origin };
  } catch {
    return null;
  }
}
