import "server-only";

import type { VideoStatus } from "@/lib/video-status";
import type { VideoMessageCode } from "@/lib/video-messages";

/**
 * Persistence contract for uploaded videos (P3-11B).
 *
 * The services in `service.ts` depend on this interface only, so they can be
 * tested against `InMemoryVideoRepository` and later backed by Prisma without
 * changing them. There is no `Video` table yet (P4-03 BLOCKED); a database
 * implementation must keep the two atomic guarantees documented below.
 *
 * Signed upload URLs are bearer credentials and are deliberately absent from
 * the record: they are returned to the uploader once and never stored.
 */

export type VideoRecord = {
  /** Our own id (UUID); sent to the provider as `passthrough` to prove ownership. */
  id: string;
  title: string;
  /** The uploader's file name, for display only (base name, validated). */
  originalFilename: string;
  /** The size the uploader declared; the provider does not enforce it (UNVERIFIED). */
  declaredSizeBytes: number;
  status: VideoStatus;
  uploaderId: string;
  muxUploadId: string;
  muxAssetId: string | null;
  /** The signed playback ID; set only when the video becomes READY. */
  playbackId: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  maxResolution: string | null;
  /** A known message code, never provider text. */
  failureCode: VideoMessageCode | null;
  /** When the provider's upload URL stops accepting the file. */
  uploadExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/** The fields a state change may set; identity and ownership never change. */
export type VideoPatch = Partial<
  Pick<VideoRecord, "status" | "muxAssetId" | "playbackId" | "durationSeconds" | "width" | "height" | "maxResolution" | "failureCode">
>;

/** One project that uses the video, with the facts public eligibility needs. */
export type VideoProjectAssignment = {
  projectId: string;
  projectStatus: "DRAFT" | "PUBLISHED";
  categoryActive: boolean;
};

export interface VideoRepository {
  findById(id: string): Promise<VideoRecord | null>;
  findByMuxUploadId(muxUploadId: string): Promise<VideoRecord | null>;
  findByMuxAssetId(muxAssetId: string): Promise<VideoRecord | null>;

  /** Uploads by this user that are UPLOAD_PENDING and whose upload URL has not expired at `now`. */
  countActiveUploads(uploaderId: string, now: Date): Promise<number>;

  /**
   * Inserts the record only if the uploader then has fewer than `limit` active
   * uploads (as `countActiveUploads` defines them). The check and the insert
   * must be atomic, so two concurrent requests cannot both pass a limit of one
   * remaining slot (in PostgreSQL: a transaction holding a per-uploader lock).
   */
  insertWithinActiveLimit(record: VideoRecord, limit: number, now: Date): Promise<"inserted" | "limit_reached">;

  /**
   * Compare-and-set: applies `patch` only while the stored status still equals
   * `expectedStatus`, and returns the updated record, or `null` when the record
   * is gone or its status has changed. Concurrent writers therefore cannot
   * overwrite each other's transitions.
   */
  updateIfStatus(id: string, expectedStatus: VideoStatus, patch: VideoPatch, now: Date): Promise<VideoRecord | null>;

  listProjectAssignments(videoId: string): Promise<VideoProjectAssignment[]>;
}
