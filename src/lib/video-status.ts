/**
 * Lifecycle of an uploaded video (MH-03 MVP), independent of any provider,
 * database, or framework.
 *
 *   UPLOAD_PENDING ──► PROCESSING ──► READY
 *        │                 │            │
 *        ├──► CANCELLED    ├──► FAILED  │
 *        └──► FAILED       │            │
 *                          ▼            ▼
 *   (READY | FAILED | CANCELLED | PROCESSING) ──► DELETING ──► (row removed)
 *                                                    │  ▲
 *                                                    ▼  │
 *                                               DELETE_FAILED
 *
 * A successful deletion removes the record, so it has no status of its own.
 * Transitions only move forward; repeating the current status is a no-op, so a
 * duplicated provider event can be applied safely.
 */

export const VIDEO_STATUSES = [
  "UPLOAD_PENDING",
  "PROCESSING",
  "READY",
  "FAILED",
  "CANCELLED",
  "DELETING",
  "DELETE_FAILED",
] as const;

export type VideoStatus = (typeof VIDEO_STATUSES)[number];

const TRANSITIONS: Readonly<Record<VideoStatus, readonly VideoStatus[]>> = {
  UPLOAD_PENDING: ["PROCESSING", "FAILED", "CANCELLED"],
  PROCESSING: ["READY", "FAILED", "DELETING"],
  READY: ["DELETING"],
  FAILED: ["DELETING"],
  CANCELLED: ["DELETING"],
  DELETING: ["DELETE_FAILED"],
  DELETE_FAILED: ["DELETING"],
};

export function isVideoStatus(value: unknown): value is VideoStatus {
  return typeof value === "string" && (VIDEO_STATUSES as readonly string[]).includes(value);
}

export function allowedNextStatuses(from: VideoStatus): readonly VideoStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: VideoStatus, to: VideoStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** What to do with a requested change: apply it, ignore a repeat, or refuse it. */
export function transitionDecision(from: VideoStatus, to: VideoStatus): "apply" | "noop" | "reject" {
  if (from === to) return "noop";
  return canTransition(from, to) ? "apply" : "reject";
}

export class InvalidVideoTransitionError extends Error {
  constructor(readonly from: VideoStatus, readonly to: VideoStatus) {
    super(`A video cannot move from ${from} to ${to}.`);
    this.name = "InvalidVideoTransitionError";
  }
}

export function assertTransition(from: VideoStatus, to: VideoStatus): void {
  if (transitionDecision(from, to) === "reject") throw new InvalidVideoTransitionError(from, to);
}

// ------------------------------------------------------------------ input validation

export const VIDEO_TITLE_MAX_LENGTH = 160;

export type TitleResult = { ok: true; value: string } | { ok: false; error: "title_required" | "title_too_long" | "title_invalid" };

/** A display title: trimmed, inner whitespace collapsed, 1–160 characters, no control characters. */
export function validateVideoTitle(input: unknown): TitleResult {
  if (typeof input !== "string") return { ok: false, error: "title_required" };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input)) return { ok: false, error: "title_invalid" };
  const value = input.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "title_required" };
  if (value.length > VIDEO_TITLE_MAX_LENGTH) return { ok: false, error: "title_too_long" };
  return { ok: true, value };
}

/**
 * The shape of a streaming provider's upload, asset, or playback identifier.
 * Letters and digits only, bounded length: enough to keep identifiers out of
 * URLs, logs, and queries safely. Mux identifiers are alphanumeric in its
 * documentation and examples; the exact length is UNVERIFIED, hence the range.
 */
const PROVIDER_ID = /^[A-Za-z0-9]{10,128}$/;

export function isValidProviderId(value: unknown): value is string {
  return typeof value === "string" && PROVIDER_ID.test(value);
}
