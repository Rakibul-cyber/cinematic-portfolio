import { resolveUmamiConfig } from "./analytics/umami";
import { sentryIngestOrigin } from "./monitoring/dsn";

/**
 * Application-specific security headers.
 *
 * Imported by `next.config.ts`, so every import below must be relative and
 * free of path aliases and server-only modules.
 *
 * Phase 9 widens exactly two directives, and only when the corresponding
 * feature is configured: the analytics tracker origin joins `script-src` and
 * `connect-src`, and the Sentry ingest origin joins `connect-src`. A
 * deployment without analytics or monitoring keeps the Phase 8 policy
 * unchanged, byte for byte.
 */

function origin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch { return null; }
}

export function securityHeaders(env: Record<string, string | undefined>) {
  const imageOrigin = origin(env.R2_PUBLIC_BASE_URL);
  // Optional observability origins. Absent unless explicitly configured, so the
  // policy never names a service the deployment does not actually use.
  const analyticsOrigin = resolveUmamiConfig(env)?.scriptOrigin ?? null;
  // Only the browser SDK needs a policy entry, and only for the one origin its
  // transport posts to. Server-side reporting is a Node request and is not
  // subject to any browser policy.
  const monitoringOrigin = sentryIngestOrigin(env.NEXT_PUBLIC_SENTRY_DSN);
  const connectOrigins = [analyticsOrigin, monitoringOrigin].filter(
    (value): value is string => Boolean(value),
  );
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${analyticsOrigin ? ` ${analyticsOrigin}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${imageOrigin ? ` ${imageOrigin}` : ""}`,
    "font-src 'self'",
    `connect-src 'self' https://challenges.cloudflare.com${connectOrigins.length ? ` ${connectOrigins.join(" ")}` : ""}`,
    "frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com",
    "media-src 'self'",
    ...(env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ];
  const headers = [
    { key: "Content-Security-Policy", value: directives.join("; ") },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
  if (env.NODE_ENV === "production") headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  return headers;
}
