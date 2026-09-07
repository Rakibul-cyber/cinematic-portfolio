import "server-only";

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "@/generated/prisma/client";
import { getServerEnv } from "@/server/env";

/**
 * Single Prisma client for the application.
 *
 * Prisma 7 connects through a driver adapter; the Neon adapter is used so the
 * application talks to Neon's pooled endpoint in a way that suits short-lived
 * serverless invocations.
 *
 * The instance is cached on `globalThis` outside production because Next.js
 * hot reload re-evaluates modules repeatedly, and a fresh client per reload
 * would exhaust the database connection limit.
 */
function createPrismaClient(): PrismaClient {
  const env = getServerEnv();

  return new PrismaClient({
    adapter: new PrismaNeon({ connectionString: env.DATABASE_URL }),
    // Errors and warnings only. Query logging is avoided so parameter values
    // never reach application logs.
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  cinematicPortfolioPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.cinematicPortfolioPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.cinematicPortfolioPrisma = prisma;
}
