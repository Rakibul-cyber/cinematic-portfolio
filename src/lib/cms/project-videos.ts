import { formatVideoDuration, formatVideoResolution, videoStatusLabel } from "@/lib/video-library";
import { isVideoStatus, type VideoStatus } from "@/lib/video-status";

/**
 * Pure rules for the uploaded videos of a project (P3-11E). Shared by the
 * server and the project editor, so it must stay free of server-only imports.
 *
 * Removing a video from a project only drops the assignment; the video stays in
 * the library. Only READY videos may be assigned, and the server checks that
 * again under a row lock when the project is saved (`project-save.ts`).
 */

/**
 * Hidden form field the video section always submits. Without it the save
 * leaves stored assignments alone, so a form without the section (an EDITOR's)
 * can never clear them by omission.
 */
export const PROJECT_VIDEO_SECTION_FIELD = "videoSection";

/** Most uploaded videos one project may show. */
export const MAX_PROJECT_VIDEOS = 20;

/**
 * What the project editor receives for one video: display facts only. Provider
 * identifiers (upload, asset, playback) never reach the browser.
 */
export type ProjectVideoOption = {
  id: string;
  title: string;
  status: VideoStatus;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  maxResolution: string | null;
};

type VideoRowLike = {
  id: string;
  title: string;
  status: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  maxResolution: string | null;
};

/** Reduces a database row to the editor's view; an unknown status is dropped rather than guessed. */
export function toProjectVideoOption(row: VideoRowLike): ProjectVideoOption | null {
  if (!isVideoStatus(row.status)) return null;
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    durationSeconds: row.durationSeconds,
    width: row.width,
    height: row.height,
    maxResolution: row.maxResolution,
  };
}

/** Attached videos first in their saved order, then READY library videos not already attached. */
export function mergeProjectVideoOptions(
  attached: readonly ProjectVideoOption[],
  ready: readonly ProjectVideoOption[],
): ProjectVideoOption[] {
  const seen = new Set<string>();
  return [...attached, ...ready.filter((video) => video.status === "READY")].filter((video) => {
    if (seen.has(video.id)) return false;
    seen.add(video.id);
    return true;
  });
}

/** Whether a video may be newly offered for, or kept in, a project. */
export function isAssignableVideo(video: { status: VideoStatus }): boolean {
  return video.status === "READY";
}

/** One line of display facts: "Ready · 1:05 · 1920 × 1080 (1080p)". */
export function projectVideoFacts(video: ProjectVideoOption): string {
  return [videoStatusLabel(video.status), formatVideoDuration(video.durationSeconds), formatVideoResolution(video)].join(" · ");
}

/** The `project_video` rows for an ordered selection. */
export function projectVideoRows(videoIds: readonly string[]) {
  return videoIds.map((videoId, sortOrder) => ({ videoId, sortOrder }));
}

/** Columns the editor pages read for a video: display facts only, never provider identifiers. */
export const PROJECT_VIDEO_OPTION_SELECT = {
  id: true,
  title: true,
  status: true,
  durationSeconds: true,
  width: true,
  height: true,
  maxResolution: true,
} as const;

/** How many READY library videos the editor offers. */
export const PROJECT_VIDEO_OPTION_LIMIT = 200;

export type ProjectFormVideosView =
  | { mode: "manage"; options: ProjectVideoOption[]; selectedIds: string[] }
  | { mode: "readonly"; titles: string[] };

/**
 * The project editor's video section: editable for ADMIN and SUPER_ADMIN
 * (`canManage`), otherwise a read-only list of the attached titles.
 */
export function buildProjectFormVideos(
  canManage: boolean,
  attached: readonly VideoRowLike[],
  ready: readonly VideoRowLike[],
): ProjectFormVideosView {
  const attachedOptions = attached.flatMap((row) => {
    const option = toProjectVideoOption(row);
    return option ? [option] : [];
  });
  if (!canManage) return { mode: "readonly", titles: attachedOptions.map((video) => video.title) };
  const readyOptions = ready.flatMap((row) => {
    const option = toProjectVideoOption(row);
    return option ? [option] : [];
  });
  return {
    mode: "manage",
    options: mergeProjectVideoOptions(attachedOptions, readyOptions),
    selectedIds: attachedOptions.map((video) => video.id),
  };
}
