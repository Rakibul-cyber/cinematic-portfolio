import { resolveUmamiConfig } from "./analytics/umami";
import { sentryIngestOrigin } from "./monitoring/dsn";
import { videoPlaybackOrigins, videoUploadOrigin } from "./video-csp";

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

/** Extra sources for one route's policy; only `/admin/videos` uses this (P3-11D). */
type PolicyExtras = { connect: string[]; media: string[] };

function contentSecurityPolicy(env: Record<string, string | undefined>, extras: PolicyExtras = { connect: [], media: [] }): string {
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
  // `next dev` only: React Refresh, webpack's eval source maps and React's dev
  // call stacks evaluate strings, so without this no page hydrates locally.
  // Production bundles never use eval and never receive it.
  const devEval = env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${devEval} https://challenges.cloudflare.com${analyticsOrigin ? ` ${analyticsOrigin}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${imageOrigin ? ` ${imageOrigin}` : ""}`,
    "font-src 'self'",
    `connect-src 'self' https://challenges.cloudflare.com${[...connectOrigins, ...extras.connect].map((value) => ` ${value}`).join("")}`,
    "frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com",
    `media-src 'self'${extras.media.map((value) => ` ${value}`).join("")}`,
    ...(env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function securityHeaders(env: Record<string, string | undefined>) {
  const headers = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
  if (env.NODE_ENV === "production") headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  return headers;
}

/**
 * The policy for `/admin/videos` only (P3-11D), listed after the global entry
 * in `next.config.ts` so this one Content-Security-Policy value replaces the
 * global one there. It adds:
 *
 * - `connect-src`: the playback origins (hls.js fetches playlists and
 *   segments) and, when configured, the direct-upload origin (UpChunk PUTs).
 * - `media-src`: `blob:` (hls.js feeds the element through Media Source
 *   Extensions) and the playback origins (Safari's native HLS loads them).
 *
 * hls.js runs without a Web Worker, so `worker-src` stays at `'self'`.
 */
export function videoAdminSecurityHeaders(env: Record<string, string | undefined>) {
  const playback = videoPlaybackOrigins(env);
  const upload = videoUploadOrigin(env);
  const connect = [...new Set([...playback, ...(upload ? [upload] : [])])];
  return [{ key: "Content-Security-Policy", value: contentSecurityPolicy(env, { connect, media: ["blob:", ...playback] }) }];
}
