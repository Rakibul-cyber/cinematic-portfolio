import "server-only";

import { APIError, createAuthMiddleware } from "better-auth/api";

import { pseudonymousKey } from "@/lib/security/rate-limit";
import { rateLimitClientKey } from "@/server/security/client-ip";
import { bucketWindow, type BucketIncrement } from "@/server/security/rate-limit-buckets";

/**
 * Durable limits on administrator sign-in attempts.
 *
 * Better Auth's own limiter is not enough here: it runs only in the HTTP router,
 * so the Server Action's `auth.api.signInEmail` call never reaches it, and its
 * default storage is per-process memory. A `hooks.before` middleware runs on both
 * paths, ahead of the password check, so this is the one enforcement point.
 *
 * Every attempt counts, whether or not the account exists or the password is
 * right, so being throttled says nothing about an account. Windows are fixed, so
 * attempts made while blocked cannot extend a block past the end of its window.
 */

export const LOGIN_POLICIES = {
  /** Distributed attempts on one account. Independent of any request header. */
  account: { scope: "admin-login:account", windowMs: 15 * 60_000, limit: 6 },
  /** One client trying many accounts, or rotating the email it submits. */
  client: { scope: "admin-login:client", windowMs: 15 * 60_000, limit: 20 },
} as const;

type LoginPolicyName = keyof typeof LOGIN_POLICIES;

export type LoginLimitDecision =
  | { outcome: "allowed" }
  | { outcome: "limited"; retryAfterSeconds: number; newlyLimited: LoginPolicyName[] }
  | { outcome: "unavailable"; reason: "unconfigured" | "storage" };

export type LoginLimitDependencies = {
  hmacKey: () => string | null;
  /** Atomically increments every bucket, in order, and returns their counts. */
  increment: (increments: BucketIncrement[]) => Promise<number[]>;
  /** Best-effort removal of expired rows. */
  prune: (now: Date) => Promise<unknown>;
  now?: () => Date;
};

/** Decides one attempt. Never throws: without a working limiter the answer is `unavailable`. */
export async function consumeLoginLimit(
  identity: { email?: string; clientKey: string },
  dependencies: LoginLimitDependencies,
): Promise<LoginLimitDecision> {
  const hmacKey = dependencies.hmacKey();
  if (!hmacKey) return { outcome: "unavailable", reason: "unconfigured" };

  const now = dependencies.now?.() ?? new Date();
  // Account first, then client, always: see `incrementBuckets` on lock order.
  const attempts: Array<{ name: LoginPolicyName; raw: string }> = [
    ...(identity.email ? [{ name: "account" as const, raw: `account:${identity.email}` }] : []),
    { name: "client", raw: identity.clientKey },
  ];

  let counts: number[];
  try {
    counts = await dependencies.increment(
      attempts.map(({ name, raw }) => ({
        scope: LOGIN_POLICIES[name].scope,
        keyHash: pseudonymousKey(raw, hmacKey),
        windowMs: LOGIN_POLICIES[name].windowMs,
        now,
      })),
    );
  } catch {
    return { outcome: "unavailable", reason: "storage" };
  }

  try {
    await dependencies.prune(now);
  } catch {
    // Expired rows are harmless; the next attempt tries again.
  }

  const exceeded = attempts.flatMap(({ name }, index) => {
    const count = counts[index] ?? Number.POSITIVE_INFINITY;
    return count > LOGIN_POLICIES[name].limit ? [{ name, count }] : [];
  });
  if (exceeded.length === 0) return { outcome: "allowed" };

  const blockedUntil = Math.max(...exceeded.map(({ name }) => bucketWindow(now, LOGIN_POLICIES[name].windowMs).windowEnd.getTime()));
  return {
    outcome: "limited",
    retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now.getTime()) / 1000)),
    newlyLimited: exceeded.filter(({ name, count }) => count === LOGIN_POLICIES[name].limit + 1).map(({ name }) => name),
  };
}

export type LoginGuardCategory = "rate_limited" | "limit_unconfigured" | "limit_storage_failed";

/** Fixed categories only. Nothing here accepts an address, an email, or an error. */
export function logLoginGuardEvent(category: LoginGuardCategory): void {
  const line = JSON.stringify({ scope: "admin-login", category });
  if (category === "rate_limited") console.warn(line);
  else console.error(line);
}

export const SIGN_IN_PATH = "/sign-in/email";

/** What the guard answers with. Fixed wording, the same for every account. */
const REFUSAL = "Too many requests. Please try again later.";

export type LoginGuardDependencies = LoginLimitDependencies & {
  log: (category: LoginGuardCategory) => void;
  /** Called once per window per limit, so a flood cannot flood the audit trail. */
  auditLimited: (limits: LoginPolicyName[]) => Promise<void>;
};

/** The `hooks.before` middleware. Every other auth endpoint passes straight through. */
export function createLoginGuard(dependencies: LoginGuardDependencies) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_IN_PATH) return;

    // Hooks run ahead of body validation, so the value may be anything. Better
    // Auth looks accounts up lowercased, so this is the same account key it uses.
    const submitted: unknown = (ctx.body as { email?: unknown } | undefined)?.email;
    const email = typeof submitted === "string" ? submitted.trim().toLowerCase() : "";

    const decision = await consumeLoginLimit(
      { ...(email ? { email } : {}), clientKey: rateLimitClientKey(ctx.headers) },
      dependencies,
    );

    if (decision.outcome === "allowed") return;
    if (decision.outcome === "unavailable") {
      dependencies.log(decision.reason === "storage" ? "limit_storage_failed" : "limit_unconfigured");
      throw new APIError("SERVICE_UNAVAILABLE", { message: REFUSAL });
    }
    dependencies.log("rate_limited");
    if (decision.newlyLimited.length > 0) await dependencies.auditLimited(decision.newlyLimited);
    throw new APIError("TOO_MANY_REQUESTS", { message: REFUSAL }, { "Retry-After": String(decision.retryAfterSeconds) });
  });
}
