import "server-only";

import { recordAuditLog } from "@/server/audit/audit-log";
import { getCurrentUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { incrementBuckets, pruneExpiredBucketsSql, rateLimitHmacKey } from "@/server/security/rate-limit-buckets";
import { buildAdminVideoLibrary, type AdminVideoLibrary } from "@/server/video/admin-library";
import type { VideoRouteDependencies } from "@/server/video/http";
import { PrismaVideoRepository } from "@/server/video/prisma-repository";
import { consumeVideoRateLimit } from "@/server/video/rate-limit";
import { buildVideoRuntime, type VideoRuntime } from "@/server/video/runtime";
import type { VideoLogger } from "@/server/video/service";

/**
 * Production wiring for the video routes: the database repository, the real
 * session, the shared rate-limit buckets, and the audit log. Kept apart from
 * `http.ts` so the request logic is tested without Prisma or Next.js.
 */

/** Log fields are typed so they cannot carry a secret or URL; values are printed as JSON. */
const logger: VideoLogger = {
  warn(event, fields) {
    console.warn(`[video] ${event}`, fields ? JSON.stringify(fields) : "");
  },
};

/** Configuration is read once per process; it does not change while an instance runs. */
let cachedRuntime: { value: VideoRuntime | null } | undefined;

function runtime(): VideoRuntime | null {
  cachedRuntime ??= {
    value: buildVideoRuntime(process.env, { repository: new PrismaVideoRepository(prisma), audit: recordAuditLog, logger }),
  };
  return cachedRuntime.value;
}

export function videoRouteDependencies(): VideoRouteDependencies {
  return {
    getUser: getCurrentUser,
    runtime,
    rateLimit: (name, rawKey) =>
      consumeVideoRateLimit(name, rawKey, {
        hmacKey: () => rateLimitHmacKey(),
        increment: (increments) => prisma.$transaction((tx) => incrementBuckets(tx, increments)),
        prune: (now) => prisma.$executeRaw(pruneExpiredBucketsSql(now)),
      }),
    audit: recordAuditLog,
  };
}

/** The admin video library page's data (P3-11D); the page has already required ADMIN. */
export function loadAdminVideoLibrary(): Promise<AdminVideoLibrary> {
  return buildAdminVideoLibrary({ repository: new PrismaVideoRepository(prisma), videoConfigured: runtime() !== null, env: process.env });
}
