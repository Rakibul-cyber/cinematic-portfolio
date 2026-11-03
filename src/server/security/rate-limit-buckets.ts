import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";

/**
 * The shared fixed-window counters behind every durable rate limit.
 *
 * All state is in PostgreSQL, so every serverless instance sees the same counts.
 * One `INSERT ... ON CONFLICT ... RETURNING` is the whole check-and-increment:
 * the row lock serializes concurrent requests, so a limit cannot be overrun by
 * requests that all read a stale count.
 */

export type BucketIncrement = {
  scope: string;
  /** Always a pseudonymous hash, never the raw identifier. */
  keyHash: string;
  windowMs: number;
  now: Date;
};

/** The window `now` falls in, and when its row may be removed. */
export function bucketWindow(now: Date, windowMs: number): { windowStart: Date; windowEnd: Date; expiresAt: Date } {
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  return {
    windowStart,
    windowEnd: new Date(windowStart.getTime() + windowMs),
    expiresAt: new Date(windowStart.getTime() + windowMs * 2),
  };
}

export function incrementBucketSql({ scope, keyHash, windowMs, now }: BucketIncrement): Prisma.Sql {
  const { windowStart, expiresAt } = bucketWindow(now, windowMs);
  return Prisma.sql`
    INSERT INTO "rate_limit_bucket"
      ("id", "scope", "keyHash", "windowStart", "count", "expiresAt", "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${scope}, ${keyHash}, ${windowStart}, 1, ${expiresAt}, ${now}, ${now})
    ON CONFLICT ("scope", "keyHash", "windowStart") DO UPDATE
      SET "count" = "rate_limit_bucket"."count" + 1,
          "expiresAt" = EXCLUDED."expiresAt",
          "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "count"
  `;
}

export type BucketClient = {
  $queryRaw<T = unknown>(query: Prisma.Sql): PromiseLike<T>;
};

/**
 * Increments each bucket in order and answers with their counts. A statement
 * that returns no row counts as over every limit. Callers keep one order for
 * their scopes, so two transactions cannot lock shared rows in opposite orders.
 */
export async function incrementBuckets(client: BucketClient, increments: readonly BucketIncrement[]): Promise<number[]> {
  const counts: number[] = [];
  for (const increment of increments) {
    const rows = await client.$queryRaw<Array<{ count: number }>>(incrementBucketSql(increment));
    counts.push(rows[0]?.count ?? Number.POSITIVE_INFINITY);
  }
  return counts;
}

/** Rows removed per request. Keeps cleanup cost flat under a flood. */
const CLEANUP_BATCH = 200;

export function pruneExpiredBucketsSql(now: Date): Prisma.Sql {
  return Prisma.sql`
    DELETE FROM "rate_limit_bucket"
    WHERE "id" IN (
      SELECT "id" FROM "rate_limit_bucket"
      WHERE "expiresAt" < ${now}
      LIMIT ${CLEANUP_BATCH}
    )
  `;
}

/**
 * The pseudonymization key, or null when no usable one is configured outside
 * local development and tests. Callers refuse the protected operation on null.
 *
 * The mode is read as the literal `process.env.NODE_ENV`, which the production
 * build replaces with `"production"`. That makes the fallback below dead code in
 * a production bundle, whatever NODE_ENV the deployed function sees at runtime.
 * An unset or unexpected mode also gets no fallback.
 */
export function rateLimitHmacKey(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.RATE_LIMIT_HMAC_SECRET?.trim();
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    return "development-only-rate-limit-secret";
  }
  return null;
}
