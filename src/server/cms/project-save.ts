import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { z } from "zod";
import { MAX_PROJECT_VIDEOS, projectVideoRows } from "@/lib/cms/project-videos";
import { projectMediaRows } from "@/lib/cms/project-media";
import { nextProjectVersion } from "@/lib/cms/project-version";
import { videoStatusLabel } from "@/lib/video-library";
import { isVideoStatus } from "@/lib/video-status";
import type { projectSchema } from "@/lib/validation/cms";

/**
 * The project save transaction (P3-11E): the project fields, its images, and
 * its uploaded videos are written together or not at all.
 *
 * It takes the Prisma client as an argument so the statements can be checked
 * against a recording fake; `saveProject` in `service.ts` passes the real one.
 *
 * Images behave exactly as before P3-11E: the stored rows are replaced by the
 * submitted order, and the first image is the cover.
 *
 * Videos are replaced only when `manageVideos` is true (an ADMIN or
 * SUPER_ADMIN save from a form that shows the video section). Every submitted
 * video row is locked with `SELECT … FOR UPDATE`, in id order so two saves can
 * never deadlock, and must then be READY. Deletion locks the same row before
 * it counts assignments (`PrismaVideoRepository.beginDeletion`), so a video
 * is either claimed for deletion first, and this save refuses it, or assigned
 * first, and the deletion refuses it.
 */

export class ProjectConflictError extends Error {}
/** A submitted video cannot be assigned; the message is safe to show the editor. */
export class ProjectVideoAssignmentError extends Error {}

export type ProjectSaveData = z.infer<typeof projectSchema>;
export type ProjectSaveClient = Pick<PrismaClient, "$transaction">;
type ProjectSaveTx = Pick<Prisma.TransactionClient, "$queryRaw" | "project" | "projectMedia" | "projectVideo">;

export type ProjectVideoChange = {
  /** Video ids newly assigned, in display order. */
  added: string[];
  /** Video ids removed from the project (the videos themselves are kept). */
  removed: string[];
  /** Whether the order of the videos that stayed changed. */
  reordered: boolean;
  count: number;
};

export type ProjectSaveResult = {
  project: Awaited<ReturnType<PrismaClient["project"]["findUniqueOrThrow"]>>;
  /** `null` when videos were not managed in this save or nothing changed. */
  videoChange: ProjectVideoChange | null;
};

/** Locks the given video rows, in id order, for the rest of the transaction. */
export function lockVideosForAssignmentSql(videoIds: readonly string[]): Prisma.Sql {
  return Prisma.sql`SELECT "id", "status", "title" FROM "video" WHERE "id" IN (${Prisma.join([...videoIds])}) ORDER BY "id" FOR UPDATE`;
}

type LockedVideo = { id: string; status: string; title: string };

/** Compares the stored and submitted orders. */
export function describeVideoChange(current: readonly string[], next: readonly string[]): ProjectVideoChange | null {
  const added = next.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !next.includes(id));
  const keptBefore = current.filter((id) => next.includes(id));
  const keptAfter = next.filter((id) => current.includes(id));
  const reordered = keptBefore.some((id, index) => keptAfter[index] !== id);
  if (!added.length && !removed.length && !reordered) return null;
  return { added, removed, reordered, count: next.length };
}

/**
 * Replaces the project's video assignments inside the caller's transaction.
 * Throws `ProjectVideoAssignmentError` (rolling the whole save back) when a
 * video is missing or not READY at the moment its row is locked.
 */
export async function replaceProjectVideos(
  tx: ProjectSaveTx,
  projectId: string,
  videoIds: readonly string[],
): Promise<ProjectVideoChange | null> {
  if (new Set(videoIds).size !== videoIds.length) throw new ProjectVideoAssignmentError("A video can only be added to a project once.");
  if (videoIds.length > MAX_PROJECT_VIDEOS) throw new ProjectVideoAssignmentError(`A project can show at most ${MAX_PROJECT_VIDEOS} videos.`);

  if (videoIds.length) {
    const locked = await tx.$queryRaw<LockedVideo[]>(lockVideosForAssignmentSql([...videoIds].sort()));
    const byId = new Map(locked.map((row) => [row.id, row]));
    for (const id of videoIds) {
      const row = byId.get(id);
      if (!row) throw new ProjectVideoAssignmentError("A selected video no longer exists. Reload the project and choose again.");
      if (row.status !== "READY") {
        const label = isVideoStatus(row.status) ? videoStatusLabel(row.status).toLowerCase() : "unavailable";
        throw new ProjectVideoAssignmentError(`“${row.title}” cannot be added because it is ${label}. Remove it from the project or wait until it is ready.`);
      }
    }
  }

  const current = (
    await tx.projectVideo.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { videoId: "asc" }],
      select: { videoId: true },
    })
  ).map((row) => row.videoId);
  const change = describeVideoChange(current, videoIds);
  if (!change) return null;

  await tx.projectVideo.deleteMany({ where: { projectId } });
  if (videoIds.length) {
    await tx.projectVideo.createMany({ data: projectVideoRows(videoIds).map((row) => ({ projectId, ...row })) });
  }
  return change;
}

/** Runs one project save; see the module comment. */
export async function runProjectSave(
  client: ProjectSaveClient,
  data: ProjectSaveData,
  options: { manageVideos: boolean },
): Promise<ProjectSaveResult> {
  const { id, expectedUpdatedAt, mediaIds, videoIds, ...fields } = data;
  const publishedAt = fields.status === "PUBLISHED" ? new Date() : null;
  return client.$transaction(async (tx: ProjectSaveTx) => {
    let project;

    if (id) {
      if (!expectedUpdatedAt) {
        throw new ProjectConflictError("Reload the project before saving.");
      }
      const updated = await tx.project.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data: {
          ...fields,
          publishedAt,
          updatedAt: nextProjectVersion(expectedUpdatedAt),
        },
      });
      if (updated.count !== 1) {
        throw new ProjectConflictError(
          "This project changed in another session. Reload it before saving.",
        );
      }
      project = await tx.project.findUniqueOrThrow({ where: { id } });
    } else {
      project = await tx.project.create({ data: { ...fields, publishedAt } });
    }

    await tx.projectMedia.deleteMany({ where: { projectId: project.id } });
    if (mediaIds.length)
      await tx.projectMedia.createMany({
        data: projectMediaRows(mediaIds).map((item) => ({
          projectId: project.id,
          ...item,
        })),
      });

    const videoChange =
      options.manageVideos && videoIds !== undefined
        ? await replaceProjectVideos(tx, project.id, videoIds)
        : null;
    return { project, videoChange };
  });
}
