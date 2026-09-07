import "server-only";

import { z } from "zod";

/**
 * Server-only environment contract.
 *
 * Every value here is a secret or a server-side configuration detail, so this
 * module must never be imported by a Client Component. The `server-only`
 * import turns an accidental client import into a build error instead of a
 * leaked credential.
 *
 * Values are validated once, on first access, and never logged.
 */
const serverEnvSchema = z.object({
  /** Pooled Neon connection used by the running application. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /**
   * Direct (unpooled) Neon connection used by Prisma Migrate. Optional at
   * runtime because the application itself only needs the pooled endpoint.
   */
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  /**
   * Better Auth signing/encryption key. A weak key would undermine session
   * integrity, so a minimum length is enforced rather than merely "present".
   */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /** Absolute origin Better Auth uses to build URLs and trust origins. */
  BETTER_AUTH_URL: z.string().url("BETTER_AUTH_URL must be an absolute URL"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | undefined;

/**
 * Returns the validated server environment.
 *
 * Failures report only variable names and validation messages. Values are
 * omitted so a misconfiguration never prints a connection string or secret
 * into logs.
 */
export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = serverEnvSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    NODE_ENV: process.env.NODE_ENV,
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");

    throw new Error(
      `Invalid server environment configuration. Fix these variables in .env.local: ${problems}`,
    );
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
