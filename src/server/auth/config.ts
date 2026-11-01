import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { AuditAction, AuditEntityType, recordAuditLog } from "@/server/audit/audit-log";
import { prisma } from "@/server/db/prisma";
import { getServerEnv } from "@/server/env";
import { createLoginGuard, logLoginGuardEvent } from "@/server/auth/login-rate-limit";
import { ADMIN_ROLE_VALUES, AdminRole } from "@/server/auth/roles";
import { NETLIFY_CLIENT_IP_HEADER } from "@/server/security/client-ip";
import { incrementBuckets, pruneExpiredBucketsSql, rateLimitHmacKey } from "@/server/security/rate-limit-buckets";

const env = getServerEnv();

/**
 * Better Auth instance for the private admin application.
 *
 * Design notes:
 * - Email/password is the only enabled method. There is no social provider and
 *   no public sign-up: `disableSignUp` closes the sign-up endpoint, so the only
 *   way to create an administrator is the server-side bootstrap script.
 * - `role` is declared as an additional user field with `input: false` so it can
 *   never be set or escalated through the auth API by a client.
 * - Sign-in attempts are limited durably by `createLoginGuard`, on the HTTP route
 *   and the Server Action alike, before any password is checked.
 * - Password hashing, session tokens, and cookie signing are handled by Better
 *   Auth using `BETTER_AUTH_SECRET`. No credential material is handled here.
 */
export const auth = betterAuth({
  appName: "Cinematic Portfolio Admin",
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.BETTER_AUTH_URL],

  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  emailAndPassword: {
    enabled: true,
    // No public registration. Administrators are provisioned server-side.
    disableSignUp: true,
    // Email delivery arrives in Phase 7; until then verification cannot be
    // required or an administrator could not sign in at all.
    requireEmailVerification: false,
    autoSignIn: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
  },

  user: {
    additionalFields: {
      role: {
        type: ADMIN_ROLE_VALUES,
        required: false,
        defaultValue: AdminRole.EDITOR,
        // Server-owned. Never accepted from API input.
        input: false,
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 8, // 8 hours: short-lived admin sessions.
    updateAge: 60 * 60, // Slide the expiry at most once per hour.
    // Session rows are read from PostgreSQL on every request rather than
    // trusting a cached cookie payload, so revoking a session takes effect
    // immediately.
    cookieCache: { enabled: false },
  },

  account: {
    // Only the credential provider is in use; account linking is not needed.
    accountLinking: { enabled: false },
  },

  hooks: {
    before: createLoginGuard({
      hmacKey: rateLimitHmacKey,
      increment: (increments) => prisma.$transaction((tx) => incrementBuckets(tx, increments)),
      prune: (now) => prisma.$executeRaw(pruneExpiredBucketsSql(now)),
      log: logLoginGuardEvent,
      auditLimited: (limits) =>
        recordAuditLog({
          action: AuditAction.AdminSignInThrottled,
          entityType: AuditEntityType.Session,
          metadata: { limits },
        }),
    }),
  },

  advanced: {
    // Better Auth would otherwise read client-supplied forwarding headers for its
    // own per-process limiter and for the IP stored on a session.
    ipAddress: { ipAddressHeaders: [NETLIFY_CLIENT_IP_HEADER] },
    useSecureCookies: env.NODE_ENV === "production",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    },
  },

  // Keeps `Set-Cookie` headers produced inside Server Actions (sign-in and
  // sign-out) applied to the response.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
