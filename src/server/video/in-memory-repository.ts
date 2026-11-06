import "server-only";

import { deletionEligibility } from "@/lib/video-eligibility";
import type { VideoStatus } from "@/lib/video-status";
import type {
  AdminVideoListItem,
  BeginDeletionResult,
  VideoPatch,
  VideoProjectAssignment,
  VideoRecord,
  VideoRepository,
} from "@/server/video/repository";

/**
 * An in-memory `VideoRepository` for tests and local experiments. Not for
 * production: data lives only in the process.
 *
 * Records are copied on the way in and out, so a caller can never change
 * stored state except through the interface. JavaScript runs each method
 * without interleaving between its awaits, which makes the limit check and the
 * compare-and-set here atomic, as the interface requires.
 */
export class InMemoryVideoRepository implements VideoRepository {
  readonly #records = new Map<string, VideoRecord>();
  readonly #assignments = new Map<string, VideoProjectAssignment[]>();

  async findById(id: string): Promise<VideoRecord | null> {
    return copy(this.#records.get(id));
  }

  async findByMuxUploadId(muxUploadId: string): Promise<VideoRecord | null> {
    return copy([...this.#records.values()].find((record) => record.muxUploadId === muxUploadId));
  }

  async findByMuxAssetId(muxAssetId: string): Promise<VideoRecord | null> {
    return copy([...this.#records.values()].find((record) => record.muxAssetId === muxAssetId));
  }

  async countActiveUploads(uploaderId: string, now: Date): Promise<number> {
    return this.#activeCount(uploaderId, now);
  }

  async insertWithinActiveLimit(record: VideoRecord, limit: number, now: Date): Promise<"inserted" | "limit_reached"> {
    if (this.#records.has(record.id)) throw new Error("Duplicate video id.");
    if ([...this.#records.values()].some((stored) => stored.muxUploadId === record.muxUploadId)) {
      throw new Error("Duplicate upload id.");
    }
    if (this.#activeCount(record.uploaderId, now) >= limit) return "limit_reached";
    this.#records.set(record.id, structuredClone(record));
    return "inserted";
  }

  async updateIfStatus(id: string, expectedStatus: VideoStatus, patch: VideoPatch, now: Date): Promise<VideoRecord | null> {
    const stored = this.#records.get(id);
    if (!stored || stored.status !== expectedStatus) return null;
    if (patch.muxAssetId && [...this.#records.values()].some((other) => other.id !== id && other.muxAssetId === patch.muxAssetId)) {
      throw new Error("Duplicate asset id.");
    }
    const updated: VideoRecord = { ...stored, ...structuredClone(patch), updatedAt: new Date(now) };
    this.#records.set(id, updated);
    return copy(updated);
  }

  async listProjectAssignments(videoId: string): Promise<VideoProjectAssignment[]> {
    return structuredClone(this.#assignments.get(videoId) ?? []);
  }

  async listForAdmin(): Promise<AdminVideoListItem[]> {
    return [...this.#records.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((record) => ({ ...structuredClone(record), assignmentCount: this.#assignments.get(record.id)?.length ?? 0 }));
  }

  async beginDeletion(id: string, now: Date, staleBefore: Date): Promise<BeginDeletionResult> {
    const stored = this.#records.get(id);
    if (!stored) return { outcome: "not_found" };
    const resumable = stored.status === "DELETING" && stored.updatedAt.getTime() < staleBefore.getTime();
    if (!resumable) {
      const eligibility = deletionEligibility(stored, this.#assignments.get(id)?.length ?? 0);
      if (!eligibility.allowed) return { outcome: "refused", reason: eligibility.reason };
    } else if ((this.#assignments.get(id)?.length ?? 0) > 0) {
      return { outcome: "refused", reason: "delete_assigned" };
    }
    const updated: VideoRecord = { ...stored, status: "DELETING", updatedAt: new Date(now) };
    this.#records.set(id, updated);
    return { outcome: "started", record: structuredClone(updated) };
  }

  async deleteIfDeleting(id: string): Promise<boolean> {
    const stored = this.#records.get(id);
    if (!stored || stored.status !== "DELETING") return false;
    // Mirrors the RESTRICT foreign key: an assigned video is never removed.
    if ((this.#assignments.get(id)?.length ?? 0) > 0) throw new Error("Video is still assigned.");
    this.#records.delete(id);
    return true;
  }

  // ---------------------------------------------------------------- test setup

  /** Stores a record as is (test setup only). */
  seed(record: VideoRecord): void {
    this.#records.set(record.id, structuredClone(record));
  }

  /** Replaces the project assignments of a video (test setup only). */
  setAssignments(videoId: string, assignments: VideoProjectAssignment[]): void {
    this.#assignments.set(videoId, structuredClone(assignments));
  }

  /** Every stored record (test inspection only). */
  all(): VideoRecord[] {
    return [...this.#records.values()].map((record) => structuredClone(record));
  }

  #activeCount(uploaderId: string, now: Date): number {
    let count = 0;
    for (const record of this.#records.values()) {
      if (record.uploaderId === uploaderId && record.status === "UPLOAD_PENDING" && record.uploadExpiresAt.getTime() > now.getTime()) count += 1;
    }
    return count;
  }
}

function copy(record: VideoRecord | undefined): VideoRecord | null {
  return record ? structuredClone(record) : null;
}
