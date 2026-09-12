import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { pseudonymousKey } from "@/lib/security/rate-limit";
import { prisma } from "@/server/db/prisma";

export type RateLimitIdentity = {
  submissionToken: string;
  normalizedEmail: string;
  trustedClientIp?: string;
};

const POLICIES = [
  { suffix: "burst", windowMs: 10 * 60_000, limit: 5 },
  { suffix: "daily", windowMs: 24 * 60 * 60_000, limit: 20 },
] as const;
/** Rows removed per request. Keeps cleanup cost flat under a submission flood. */
const CLEANUP_BATCH = 200;
let warnedMissingSecret = false;

function secret(): string | null {
  const configured = process.env.RATE_LIMIT_HMAC_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  return process.env.NODE_ENV === "production"
    ? null
    : "development-only-rate-limit-secret";
}

export async function consumeInquiryLimit(
  identity: RateLimitIdentity,
  now = new Date(),
): Promise<{ allowed: boolean; configured: boolean }> {
  const hmacKey = secret();
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
      const windowStart = new Date(
        Math.floor(now.getTime() / policy.windowMs) * policy.windowMs,
      );
      const expiresAt = new Date(windowStart.getTime() + policy.windowMs * 2);
      for (const raw of identities) {
        const keyHash = pseudonymousKey(raw, hmacKey);
        const rows = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        INSERT INTO "rate_limit_bucket"
          ("id", "scope", "keyHash", "windowStart", "count", "expiresAt", "createdAt", "updatedAt")
        VALUES
          (${randomUUID()}, ${`inquiry:${policy.suffix}`}, ${keyHash}, ${windowStart}, 1, ${expiresAt}, ${now}, ${now})
        ON CONFLICT ("scope", "keyHash", "windowStart") DO UPDATE
          SET "count" = "rate_limit_bucket"."count" + 1,
              "expiresAt" = EXCLUDED."expiresAt",
              "updatedAt" = EXCLUDED."updatedAt"
        RETURNING "count"
        `);
        if ((rows[0]?.count ?? policy.limit + 1) > policy.limit) allowed = false;
      }
    }
  });

  // Opportunistic cleanup, bounded so a flood of submissions cannot turn every
  // request into an unbounded DELETE, and non-fatal so a cleanup problem can
  // never reject a legitimate inquiry that already passed the limiter.
  try {
    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "rate_limit_bucket"
      WHERE "id" IN (
        SELECT "id" FROM "rate_limit_bucket"
        WHERE "expiresAt" < ${now}
        LIMIT ${CLEANUP_BATCH}
      )
    `);
  } catch {
    // Expired rows are harmless; the next request tries again.
  }
  return { allowed, configured: true };
}
