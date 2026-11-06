import "server-only";

import { pseudonymousKey } from "@/lib/security/rate-limit";
import type { BucketIncrement } from "@/server/security/rate-limit-buckets";

/**
 * Durable limits for the video routes, on the shared fixed-window buckets
 * (`rate_limit_bucket`). Keys are pseudonymous HMACs, never raw user IDs or
 * addresses. Without a working limiter the answer is `unavailable`, and the
 * routes refuse the request: video never runs unthrottled.
 *
 * The webhook is not limited here: it is authenticated by its signature, its
 * body is capped, and refusing the provider's bursts would only delay state.
 */

export const VIDEO_RATE_LIMITS = {
  /** Starting direct uploads, per administrator. */
  upload: { scope: "video:upload", windowMs: 60 * 60_000, limit: 10 },
  /** Cancelling uploads, per administrator. */
  cancel: { scope: "video:cancel", windowMs: 10 * 60_000, limit: 30 },
  /** Permanent deletions and their retries, per administrator (P3-11D). */
  delete: { scope: "video:delete", windowMs: 10 * 60_000, limit: 30 },
  /** Admin preview tokens, per administrator. */
  playbackAdmin: { scope: "video:playback-admin", windowMs: 10 * 60_000, limit: 120 },
  /** Public playback tokens, per client (Netlify client address or the shared unknown bucket). */
  playbackPublic: { scope: "video:playback-public", windowMs: 10 * 60_000, limit: 60 },
} as const;

export type VideoRateLimitName = keyof typeof VIDEO_RATE_LIMITS;
export type VideoRateLimitDecision = "allowed" | "limited" | "unavailable";

export type VideoRateLimitDependencies = {
  hmacKey: () => string | null;
  /** Atomically increments every bucket and returns their counts. */
  increment: (increments: BucketIncrement[]) => Promise<number[]>;
  /** Best-effort removal of expired rows. */
  prune?: (now: Date) => Promise<unknown>;
  now?: () => Date;
};

/** Counts one request. Never throws. */
export async function consumeVideoRateLimit(
  name: VideoRateLimitName,
  rawKey: string,
  dependencies: VideoRateLimitDependencies,
): Promise<VideoRateLimitDecision> {
  const policy = VIDEO_RATE_LIMITS[name];
  let hmacKey: string | null;
  try {
    hmacKey = dependencies.hmacKey();
  } catch {
    hmacKey = null;
  }
  if (!hmacKey) return "unavailable";

  const now = dependencies.now?.() ?? new Date();
  let counts: number[];
  try {
    counts = await dependencies.increment([{ scope: policy.scope, keyHash: pseudonymousKey(rawKey, hmacKey), windowMs: policy.windowMs, now }]);
  } catch {
    return "unavailable";
  }
  try {
    await dependencies.prune?.(now);
  } catch {
    // Expired rows are harmless; the next request tries again.
  }
  return counts.length === 1 && counts[0]! <= policy.limit ? "allowed" : "limited";
}
