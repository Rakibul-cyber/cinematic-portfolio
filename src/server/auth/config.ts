import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { prisma } from "@/server/db/prisma";
import { getServerEnv } from "@/server/env";
import { ADMIN_ROLE_VALUES, AdminRole } from "@/server/auth/roles";

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

  advanced: {
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
