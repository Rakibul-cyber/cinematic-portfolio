/**
 * Content-Security-Policy origins for uploaded video (P3-11D).
 *
 * Imported by `next.config.ts` through `security-headers.ts`, so it must stay
 * free of path aliases and server-only modules.
 *
 * Only the admin video library (`/admin/videos`) receives a widened policy;
 * every other route keeps the global policy unchanged. Origins are explicit
 * HTTPS origins: never a wildcard, path, or credential.
 *
 * - Playback: signed playlists are served from `https://stream.mux.com`
 *   (`src/server/video/playback-token.ts`). The hosts of the segments the
 *   playlist points to are UNVERIFIED (MH-02D provider trial), so further
 *   origins come only from `VIDEO_PLAYBACK_ORIGINS`.
 * - Upload: the host of Mux direct-upload URLs is UNVERIFIED. Uploads stay
 *   disabled in the admin until `VIDEO_UPLOAD_ORIGIN` names it, and the
 *   browser refuses an upload URL on any other origin.
 */

export const VIDEO_PLAYLIST_ORIGIN = "https://stream.mux.com";

/** The exact origin of an absolute https URL with no credentials, path, query, or wildcard; otherwise null. */
export function parseHttpsOrigin(value: string | undefined | null): string | null {
  const input = value?.trim();
  if (!input || input.includes("*")) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The configured upload origin, or null (uploads disabled). */
export function videoUploadOrigin(env: Record<string, string | undefined>): string | null {
  return parseHttpsOrigin(env.VIDEO_UPLOAD_ORIGIN);
}

/**
 * The playlist origin plus `VIDEO_PLAYBACK_ORIGINS` (space- or comma-separated).
 * One invalid entry discards every extra entry: a typo never widens the policy
 * in an unexpected way.
 */
export function videoPlaybackOrigins(env: Record<string, string | undefined>): string[] {
  const entries = (env.VIDEO_PLAYBACK_ORIGINS ?? "").split(/[\s,]+/).filter(Boolean);
  const parsed = entries.map(parseHttpsOrigin);
  if (parsed.some((origin) => origin === null)) return [VIDEO_PLAYLIST_ORIGIN];
  return [...new Set([VIDEO_PLAYLIST_ORIGIN, ...(parsed as string[])])];
}
