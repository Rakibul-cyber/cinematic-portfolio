import { deletionEligibility } from "@/lib/video-eligibility";
import { videoErrorMessage, type VideoMessageCode } from "@/lib/video-messages";
import type { VideoStatus } from "@/lib/video-status";

/**
 * Pure presentation rules for the admin video library (P3-11D). Shared by the
 * server page and the client components, so it must stay free of server-only
 * imports.
 *
 * `AdminVideoView` is what the browser receives: display facts only. Provider
 * identifiers (upload, asset, and playback IDs) never leave the server; the
 * browser asks for a short-lived playback URL by our own video id instead.
 */

export const ADMIN_VIDEOS_PATH = "/admin/videos";

export type AdminVideoView = {
  id: string;
  title: string;
  originalFilename: string;
  status: VideoStatus;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  maxResolution: string | null;
  failureCode: VideoMessageCode | null;
  assignmentCount: number;
  createdAt: string;
};

const STATUS_LABELS: Record<VideoStatus, string> = {
  UPLOAD_PENDING: "Uploading",
  PROCESSING: "Processing",
  READY: "Ready",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  DELETING: "Deleting",
  DELETE_FAILED: "Delete failed",
};

export function videoStatusLabel(status: VideoStatus): string {
  return STATUS_LABELS[status];
}

/** States the library keeps refreshing until they settle. */
export function isVideoInFlight(status: VideoStatus): boolean {
  return status === "UPLOAD_PENDING" || status === "PROCESSING" || status === "DELETING";
}

/** "1:05", "12:00", "1:02:03"; an em dash when unknown. */
export function formatVideoDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** "3840 × 2160 (2160p)", "1920 × 1080", or an em dash when unknown. */
export function formatVideoResolution(video: Pick<AdminVideoView, "width" | "height" | "maxResolution">): string {
  if (!video.width || !video.height) return "—";
  const tier = video.maxResolution && /^\d{3,4}p$/.test(video.maxResolution) ? ` (${video.maxResolution})` : "";
  return `${video.width} × ${video.height}${tier}`;
}

export type VideoRowActions = {
  preview: boolean;
  cancel: boolean;
  /** "delete", "retry", or null when deletion is not offered. */
  delete: "delete" | "retry" | null;
  /** Why deletion is not offered, when there is a reason worth showing. */
  deleteBlockedMessage: string | null;
};

/** Which controls a row shows. The server enforces the same rules; this only avoids offering refused actions. */
export function videoRowActions(video: Pick<AdminVideoView, "status" | "assignmentCount">): VideoRowActions {
  const eligibility = deletionEligibility(video, video.assignmentCount);
  const deletable = eligibility.allowed;
  return {
    preview: video.status === "READY",
    cancel: video.status === "UPLOAD_PENDING",
    delete: deletable ? (video.status === "DELETE_FAILED" ? "retry" : "delete") : null,
    deleteBlockedMessage: !eligibility.allowed && eligibility.reason === "delete_assigned" ? videoErrorMessage("delete_assigned") : null,
  };
}

/** The status line under a row: a failure reason, or a hint while in flight. */
export function videoStatusDetail(video: Pick<AdminVideoView, "status" | "failureCode">): string | null {
  switch (video.status) {
    case "UPLOAD_PENDING":
      return "Waiting for the file to finish uploading.";
    case "PROCESSING":
      return "Mux is preparing the video. This page updates on its own.";
    case "FAILED":
      return videoErrorMessage(video.failureCode ?? "processing_failed");
    case "DELETE_FAILED":
      return videoErrorMessage("delete_failed");
    case "DELETING":
      return "Deleting…";
    default:
      return null;
  }
}

/** The confirmation text for permanent deletion. */
export function videoDeleteConfirmation(title: string): string {
  return `Permanently delete “${title}”? The video is removed from Mux and cannot be recovered.`;
}
