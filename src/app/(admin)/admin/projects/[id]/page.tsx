import { notFound } from "next/navigation";
import { AdminShell, Notice } from "@/components/admin/admin-shell";
import { ProjectForm } from "@/components/admin/project-form";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { mergeProjectMediaOptions } from "@/lib/cms/project-media";
import {
  buildProjectFormVideos,
  PROJECT_VIDEO_OPTION_LIMIT,
  PROJECT_VIDEO_OPTION_SELECT,
} from "@/lib/cms/project-videos";
import { isAdministrative } from "@/server/auth/roles";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const user = await requireUser(`/admin/projects/${id}`);
  const canManageVideos = isAdministrative(user.role);
  const [project, categories, media, readyVideos] = await Promise.all([
    prisma.project.findUnique({
      where: { id },
      include: {
        media: {
          orderBy: { sortOrder: "asc" },
          select: {
            mediaId: true,
            media: {
              select: { id: true, originalName: true, altText: true },
            },
          },
        },
        videos: {
          orderBy: [{ sortOrder: "asc" }, { videoId: "asc" }],
          select: { video: { select: PROJECT_VIDEO_OPTION_SELECT } },
        },
      },
    }),
    prisma.portfolioCategory.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.media.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, originalName: true, altText: true },
    }),
    // Only an ADMIN or SUPER_ADMIN is offered the video library.
    canManageVideos
      ? prisma.video.findMany({
          where: { status: "READY" },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: PROJECT_VIDEO_OPTION_LIMIT,
          select: PROJECT_VIDEO_OPTION_SELECT,
        })
      : Promise.resolve([]),
  ]);
  if (!project) notFound();
  const mediaOptions = mergeProjectMediaOptions(
    project.media.map((item) => item.media),
    media,
  );
  const { error } = await searchParams;
  return (
    <AdminShell user={user} title="Edit project">
      <Notice message={error} />
      <ProjectForm
        project={project}
        categories={categories}
        media={mediaOptions}
        videos={buildProjectFormVideos(
          canManageVideos,
          project.videos.map((item) => item.video),
          readyVideos,
        )}
      />
    </AdminShell>
  );
}
