import type { DeletionEligibility } from "@/lib/video-eligibility";
import type { TitleResult } from "@/lib/video-status";
import type { VideoUrlError } from "@/lib/video-url";

/**
 * Plain-language admin messages for video failures.
 *
 * Every failure is reduced to a known code before it reaches the interface.
 * Provider error text, stack traces, and identifiers are never shown: an
 * unknown code maps to a generic message instead of being echoed, so nothing a
 * provider or attacker sends can reach the page verbatim.
 */

const MESSAGES = {
  // Upload
  upload_failed: "The video could not be uploaded. Check your connection and try again.",
  upload_interrupted: "The upload was interrupted. Keep this page open and try again.",
  upload_expired: "The upload link expired before the file finished uploading. Start the upload again.",
  upload_cancelled: "The upload was cancelled.",
  file_too_large: "This video is larger than the allowed upload size.",
  unsupported_file: "This file is not a supported video. Choose a video file such as MP4 or MOV.",
  too_many_uploads: "Another upload is still in progress. Wait for it to finish before starting a new one.",
  rate_limited: "Too many upload attempts. Wait a few minutes and try again.",
  not_configured: "Video uploads are not available yet. Ask the site administrator to finish the video setup.",
  // Processing
  processing_failed: "The video could not be processed. Try exporting it again and upload the new file.",
  input_unsupported: "The video format could not be processed. Export it as H.264 or HEVC in an MP4 or MOV file and try again.",
  duration_exceeded: "This video is longer than the allowed duration.",
  // Deletion
  delete_assigned: "This video is used by a project. Remove it from every project before deleting it.",
  delete_upload_in_progress: "This video is still uploading. Cancel the upload instead.",
  delete_in_progress: "This video is already being deleted.",
  delete_failed: "The video could not be deleted. Try again in a moment.",
  // Links
  link_empty: "Paste a YouTube or Vimeo link.",
  link_invalid: "This is not a valid link. Copy the address of the video page and paste it here.",
  link_unsupported: "Only YouTube and Vimeo links are supported.",
  link_missing_id: "This link does not point to a single video. Open the video itself and copy its address.",
  link_private: "This Vimeo link is missing or has an invalid privacy code. Copy the full share link from Vimeo.",
  // Titles
  title_required: "Enter a title for the video.",
  title_too_long: "The title must be 160 characters or fewer.",
  title_invalid: "The title contains characters that are not allowed.",
  // Fallback
  unknown: "Something went wrong with this video. Try again, and contact the site administrator if it keeps happening.",
} as const;

export type VideoMessageCode = keyof typeof MESSAGES;

export const VIDEO_MESSAGE_CODES = Object.keys(MESSAGES) as VideoMessageCode[];

export function isVideoMessageCode(value: unknown): value is VideoMessageCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MESSAGES, value);
}

/** The message for a code; anything unknown, including raw provider text, becomes the generic message. */
export function videoErrorMessage(code: unknown): string {
  return isVideoMessageCode(code) ? MESSAGES[code] : MESSAGES.unknown;
}

/**
 * Reduces a stored or reported failure to a known processing code, so a
 * provider's own error string is never persisted or displayed.
 */
export function toVideoFailureCode(raw: unknown): VideoMessageCode {
  return isVideoMessageCode(raw) ? raw : "processing_failed";
}

const URL_CODES: Record<VideoUrlError, VideoMessageCode> = {
  empty: "link_empty",
  too_long: "link_invalid",
  not_a_url: "link_invalid",
  unsupported_scheme: "link_invalid",
  credentials_not_allowed: "link_invalid",
  unsupported_host: "link_unsupported",
  missing_id: "link_missing_id",
  invalid_id: "link_missing_id",
  invalid_hash: "link_private",
};

export function videoUrlErrorMessage(error: VideoUrlError): string {
  return videoErrorMessage(URL_CODES[error]);
}

export function videoTitleErrorMessage(result: Extract<TitleResult, { ok: false }>): string {
  return videoErrorMessage(result.error);
}

export function videoDeletionMessage(result: Extract<DeletionEligibility, { allowed: false }>): string {
  return videoErrorMessage(result.reason);
}
