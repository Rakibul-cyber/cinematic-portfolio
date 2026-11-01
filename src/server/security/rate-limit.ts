import "server-only";

import { pseudonymousKey } from "@/lib/security/rate-limit";
import { prisma } from "@/server/db/prisma";
import { incrementBuckets, pruneExpiredBucketsSql, rateLimitHmacKey } from "@/server/security/rate-limit-buckets";

export type RateLimitIdentity = {
  submissionToken: string;
  normalizedEmail: string;
  trustedClientIp?: string;
};

const POLICIES = [
  { suffix: "burst", windowMs: 10 * 60_000, limit: 5 },
  { suffix: "daily", windowMs: 24 * 60 * 60_000, limit: 20 },
] as const;
let warnedMissingSecret = false;

export async function consumeInquiryLimit(
  identity: RateLimitIdentity,
  now = new Date(),
): Promise<{ allowed: boolean; configured: boolean }> {
  const hmacKey = rateLimitHmacKey();
  if (!hmacKey) {
    if (!warnedMissingSecret) {
      warnedMissingSecret = true;
      console.error("[security] Rate limiting is unavailable. Check RATE_LIMIT_HMAC_SECRET.");
    }
    return { allowed: false, configured: false };
  }

  // Netlify overwrites this platform header. If unavailable, use two weaker
  // pseudonymous signals honestly rather than trusting X-Forwarded-For.
  const identities = identity.trustedClientIp
    ? [`ip:${identity.trustedClientIp}`, `email:${identity.normalizedEmail}`]
    : [
        `email:${identity.normalizedEmail}`,
        `submission:${identity.submissionToken}`,
      ];

  let allowed = true;
  await prisma.$transaction(async (tx) => {
    for (const policy of POLICIES) {
      const counts = await incrementBuckets(
        tx,
        identities.map((raw) => ({
          scope: `inquiry:${policy.suffix}`,
          keyHash: pseudonymousKey(raw, hmacKey),
          windowMs: policy.windowMs,
          now,
        })),
      );
      if (counts.some((count) => count > policy.limit)) allowed = false;
    }
  });

  // Opportunistic cleanup, bounded so a flood of submissions cannot turn every
  // request into an unbounded DELETE, and non-fatal so a cleanup problem can
  // never reject a legitimate inquiry that already passed the limiter.
  try {
    await prisma.$executeRaw(pruneExpiredBucketsSql(now));
  } catch {
    // Expired rows are harmless; the next request tries again.
  }
  return { allowed, configured: true };
}
