import "server-only";

import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { toVideoFailureCode } from "@/lib/video-messages";
import { deletionEligibility } from "@/lib/video-eligibility";
import { isVideoStatus, type VideoStatus } from "@/lib/video-status";
import type {
  AdminVideoListItem,
  BeginDeletionResult,
  VideoPatch,
  VideoProjectAssignment,
  VideoRecord,
  VideoRepository,
} from "@/server/video/repository";

/**
 * PostgreSQL implementation of `VideoRepository` (P3-11C).
 *
 * The two guarantees the services rely on are kept in the database, never in
 * process memory, so they hold across serverless instances:
 *
 * 1. Active-upload limit. `insertWithinActiveLimit` runs in one transaction
 *    that first takes a transaction-scoped advisory lock keyed by the uploader,
 *    then counts and inserts. Concurrent requests for the same uploader queue
 *    on the lock; under READ COMMITTED each statement sees rows committed
 *    before it, so the second request counts the first one's insert. The lock
 *    is released at commit or rollback, so it cannot leak (and is safe through
 *    a transaction-mode pooler, unlike a session lock).
 *
 * 2. Forward-only transitions. `updateIfStatus` is a single
 *    `UPDATE ... WHERE id = $1 AND status = $2`: a stale webhook whose expected
 *    status no longer matches changes nothing and gets `null` back.
 *
 3. Deletion (P3-11D). `beginDeletion` locks the video row (`FOR UPDATE`),
 *    counts its assignments, and moves it to DELETING in one transaction. The
 *    row lock makes a concurrent `updateIfStatus` or assignment insert (whose
 *    foreign-key check takes `FOR KEY SHARE` on the video row) wait until the
 *    claim commits. A future assignment feature must refuse any video that is
 *    not READY, under the same row lock, so a DELETING video cannot gain a
 *    project. `deleteIfDeleting` removes the row only while it is DELETING,
 *    and the `project_video → video` foreign key is `RESTRICT`, so an assigned
 *    video can never be removed, even by a buggy caller.
 *
 * UNVERIFIED: none of this has run against PostgreSQL yet; database-backed
 * tests are BLOCKED by P4-03. The unit tests check the statements and their
 * order against a fake client only.
 */

export type VideoPrismaClient = Pick<PrismaClient, "$transaction" | "video" | "projectVideo">;
type TransactionClient = Pick<Prisma.TransactionClient, "$queryRaw" | "video" | "projectVideo">;

const ADVISORY_LOCK_NAMESPACE = "munir-visuals:video-upload:";

/** A stable signed 64-bit advisory-lock key for one uploader. */
export function uploaderLockKey(uploaderId: string): bigint {
  return createHash("sha256").update(ADVISORY_LOCK_NAMESPACE).update(uploaderId).digest().readBigInt64BE(0);
}

export function uploaderLockSql(uploaderId: string): Prisma.Sql {
  return Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(${uploaderLockKey(uploaderId)})`;
}

/** Locks one video row for the rest of the caller's transaction (deletion, P3-11D). */
export function lockVideoRowSql(videoId: string): Prisma.Sql {
  return Prisma.sql`SELECT "id", "status", "updatedAt" FROM "video" WHERE "id" = ${videoId} FOR UPDATE`;
}

type LockedVideoRow = { id: string; status: string; updatedAt: Date };

const activeUploadsWhere = (uploaderId: string, now: Date) =>
  ({ uploaderId, status: "UPLOAD_PENDING", uploadExpiresAt: { gt: now } }) as const;

type VideoRow = {
  id: string;
  title: string;
  originalFilename: string;
  declaredSizeBytes: bigint;
  status: string;
  uploaderId: string;
  muxUploadId: string;
  muxAssetId: string | null;
  playbackId: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  maxResolution: string | null;
  failureCode: string | null;
  uploadExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export function toVideoRecord(row: VideoRow): VideoRecord {
  if (!isVideoStatus(row.status)) throw new Error("Stored video has an unknown status.");
  const declaredSizeBytes = Number(row.declaredSizeBytes);
  if (!Number.isSafeInteger(declaredSizeBytes)) throw new Error("Stored video size is out of range.");
  return {
    id: row.id,
    title: row.title,
    originalFilename: row.originalFilename,
    declaredSizeBytes,
    status: row.status,
    uploaderId: row.uploaderId,
    muxUploadId: row.muxUploadId,
    muxAssetId: row.muxAssetId,
    playbackId: row.playbackId,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
    maxResolution: row.maxResolution,
    failureCode: row.failureCode === null ? null : toVideoFailureCode(row.failureCode),
    uploadExpiresAt: row.uploadExpiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCreateData(record: VideoRecord) {
  return {
    id: record.id,
    title: record.title,
    originalFilename: record.originalFilename,
    declaredSizeBytes: BigInt(record.declaredSizeBytes),
    status: record.status,
    uploaderId: record.uploaderId,
    muxUploadId: record.muxUploadId,
    muxAssetId: record.muxAssetId,
    playbackId: record.playbackId,
    durationSeconds: record.durationSeconds,
    width: record.width,
    height: record.height,
    maxResolution: record.maxResolution,
    failureCode: record.failureCode,
    uploadExpiresAt: record.uploadExpiresAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Only the patchable columns; identity and ownership can never be changed through a patch. */
function toUpdateData(patch: VideoPatch, now: Date) {
  const data: Record<string, unknown> = { updatedAt: now };
  for (const key of ["status", "muxAssetId", "playbackId", "durationSeconds", "width", "height", "maxResolution", "failureCode"] as const) {
    if (patch[key] !== undefined) data[key] = patch[key];
  }
  return data;
}

const isNotFound = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";

export class PrismaVideoRepository implements VideoRepository {
  constructor(private readonly client: VideoPrismaClient) {}

  async findById(id: string): Promise<VideoRecord | null> {
    const row = await this.client.video.findUnique({ where: { id } });
    return row ? toVideoRecord(row) : null;
  }

  async findByMuxUploadId(muxUploadId: string): Promise<VideoRecord | null> {
    const row = await this.client.video.findUnique({ where: { muxUploadId } });
    return row ? toVideoRecord(row) : null;
  }

  async findByMuxAssetId(muxAssetId: string): Promise<VideoRecord | null> {
    const row = await this.client.video.findUnique({ where: { muxAssetId } });
    return row ? toVideoRecord(row) : null;
  }

  async countActiveUploads(uploaderId: string, now: Date): Promise<number> {
    return this.client.video.count({ where: activeUploadsWhere(uploaderId, now) });
  }

  async insertWithinActiveLimit(record: VideoRecord, limit: number, now: Date): Promise<"inserted" | "limit_reached"> {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("limit must be a positive integer.");
    return this.client.$transaction(async (tx: TransactionClient) => {
      // Serializes every insert for this uploader until commit.
      await tx.$queryRaw(uploaderLockSql(record.uploaderId));
      const active = await tx.video.count({ where: activeUploadsWhere(record.uploaderId, now) });
      if (active >= limit) return "limit_reached" as const;
      await tx.video.create({ data: toCreateData(record) });
      return "inserted" as const;
    });
  }

  async updateIfStatus(id: string, expectedStatus: VideoStatus, patch: VideoPatch, now: Date): Promise<VideoRecord | null> {
    try {
      // One statement: UPDATE "video" SET ... WHERE "id" = $1 AND "status" = $2 RETURNING *.
      const row = await this.client.video.update({ where: { id, status: expectedStatus }, data: toUpdateData(patch, now) });
      return toVideoRecord(row);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listProjectAssignments(videoId: string): Promise<VideoProjectAssignment[]> {
    const rows = await this.client.projectVideo.findMany({
      where: { videoId },
      select: { projectId: true, project: { select: { status: true, category: { select: { isActive: true } } } } },
      orderBy: { projectId: "asc" },
    });
    return rows.map((row) => ({ projectId: row.projectId, projectStatus: row.project.status, categoryActive: row.project.category.isActive }));
  }

  async listForAdmin(): Promise<AdminVideoListItem[]> {
    const rows = await this.client.video.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      include: { _count: { select: { projects: true } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...toVideoRecord(row), assignmentCount: _count.projects }));
  }

  async beginDeletion(id: string, now: Date, staleBefore: Date): Promise<BeginDeletionResult> {
    return this.client.$transaction(async (tx: TransactionClient) => {
      const locked = await tx.$queryRaw<LockedVideoRow[]>(lockVideoRowSql(id));
      const row = locked[0];
      if (!row) return { outcome: "not_found" } as const;
      if (!isVideoStatus(row.status)) throw new Error("Stored video has an unknown status.");
      const assignmentCount = await tx.projectVideo.count({ where: { videoId: id } });
      const resumable = row.status === "DELETING" && new Date(row.updatedAt).getTime() < staleBefore.getTime();
      if (resumable) {
        if (assignmentCount > 0) return { outcome: "refused", reason: "delete_assigned" } as const;
      } else {
        const eligibility = deletionEligibility({ status: row.status }, assignmentCount);
        if (!eligibility.allowed) return { outcome: "refused", reason: eligibility.reason } as const;
      }
      const updated = await tx.video.update({ where: { id }, data: { status: "DELETING", updatedAt: now } });
      return { outcome: "started", record: toVideoRecord(updated) } as const;
    });
  }

  async deleteIfDeleting(id: string): Promise<boolean> {
    // DELETE ... WHERE "id" = $1 AND "status" = 'DELETING'. A remaining
    // assignment makes the RESTRICT foreign key fail the statement.
    const result = await this.client.video.deleteMany({ where: { id, status: "DELETING" } });
    return result.count === 1;
  }
}
