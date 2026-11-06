import type { VideoStatus } from "@/lib/video-status";

/**
 * Pure rules for who may see a video and when it may be permanently deleted.
 *
 * Publication mirrors `PUBLISHED_PROJECT_WHERE` in
 * `src/server/public/publication.ts`: a project is public only when it is
 * PUBLISHED and its category is active. A video is public only while it is
 * READY and attached to at least one such project, so a video shared by
 * several projects stays visible while any one of them qualifies.
 *
 * Removing a video from a project and permanently deleting it are different
 * operations: removal only drops the assignment; deletion destroys the video
 * and is refused while any project, draft or published, still uses it.
 */

export type ProjectAssignment = {
  projectStatus: "DRAFT" | "PUBLISHED";
  categoryActive: boolean;
};

export type PublicEligibility =
  | { eligible: true }
  | { eligible: false; reason: "not_ready" | "unassigned" | "no_published_project" };

export function isPublicProject(assignment: ProjectAssignment): boolean {
  return assignment.projectStatus === "PUBLISHED" && assignment.categoryActive;
}

export function publicEligibility(video: { status: VideoStatus }, assignments: readonly ProjectAssignment[]): PublicEligibility {
  if (video.status !== "READY") return { eligible: false, reason: "not_ready" };
  if (assignments.length === 0) return { eligible: false, reason: "unassigned" };
  if (!assignments.some(isPublicProject)) return { eligible: false, reason: "no_published_project" };
  return { eligible: true };
}

export function isPubliclyEligible(video: { status: VideoStatus }, assignments: readonly ProjectAssignment[]): boolean {
  return publicEligibility(video, assignments).eligible;
}

export type DeletionEligibility =
  | { allowed: true }
  | { allowed: false; reason: "delete_assigned" | "delete_upload_in_progress" | "delete_in_progress" };

/**
 * Whether a video may be permanently deleted. Role checks (ADMIN or
 * SUPER_ADMIN, ADR 0004) and locking against a concurrent assignment belong to
 * the server action; this only decides from the facts it is given.
 */
export function deletionEligibility(video: { status: VideoStatus }, assignmentCount: number): DeletionEligibility {
  if (!Number.isInteger(assignmentCount) || assignmentCount < 0) throw new RangeError("assignmentCount must be a non-negative integer.");
  if (video.status === "DELETING") return { allowed: false, reason: "delete_in_progress" };
  // An upload still in flight is cancelled, not deleted.
  if (video.status === "UPLOAD_PENDING") return { allowed: false, reason: "delete_upload_in_progress" };
  if (assignmentCount > 0) return { allowed: false, reason: "delete_assigned" };
  return { allowed: true };
}
