import "server-only";

import type { AdminVideoView } from "@/lib/video-library";
import { videoUploadOrigin } from "@/lib/video-csp";
import type { AdminVideoListItem, VideoRepository } from "@/server/video/repository";

/**
 * Data for the admin video library page (P3-11D). The caller has already
 * required ADMIN or SUPER_ADMIN. Production wiring is `loadAdminVideoLibrary`
 * in `route-deps.ts`.
 *
 * Only display facts reach the browser: provider upload, asset, and playback
 * IDs stay on the server (`toAdminVideoView`).
 */

export type AdminVideoLibrary = {
  videos: AdminVideoView[];
  /** The upload origin when uploads can start; null otherwise. */
  uploadOrigin: string | null;
  /** Why uploads are off, for the page; null when they are on. */
  uploadsUnavailableMessage: string | null;
};

export function toAdminVideoView(item: AdminVideoListItem): AdminVideoView {
  return {
    id: item.id,
    title: item.title,
    originalFilename: item.originalFilename,
    status: item.status,
    durationSeconds: item.durationSeconds,
    width: item.width,
    height: item.height,
    maxResolution: item.maxResolution,
    failureCode: item.failureCode,
    assignmentCount: item.assignmentCount,
    createdAt: item.createdAt.toISOString(),
  };
}

export type AdminVideoLibrarySources = {
  repository: VideoRepository;
  videoConfigured: boolean;
  env: Record<string, string | undefined>;
};

export async function buildAdminVideoLibrary(sources: AdminVideoLibrarySources): Promise<AdminVideoLibrary> {
  const videos = (await sources.repository.listForAdmin()).map(toAdminVideoView);
  const origin = videoUploadOrigin(sources.env);
  let uploadsUnavailableMessage: string | null = null;
  if (!sources.videoConfigured) {
    uploadsUnavailableMessage = "Video uploads are not available yet. Ask the site administrator to finish the video setup.";
  } else if (!origin) {
    // The direct-upload host must be confirmed and allowed by the page policy first (UNVERIFIED, MH-02D).
    uploadsUnavailableMessage = "Video uploads are switched off until the upload host is confirmed for this site.";
  }
  return { videos, uploadOrigin: uploadsUnavailableMessage ? null : origin, uploadsUnavailableMessage };
}
