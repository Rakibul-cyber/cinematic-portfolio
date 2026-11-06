import { AdminShell, Notice } from "@/components/admin/admin-shell";
import { ProjectForm } from "@/components/admin/project-form";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import {
  buildProjectFormVideos,
  PROJECT_VIDEO_OPTION_LIMIT,
  PROJECT_VIDEO_OPTION_SELECT,
} from "@/lib/cms/project-videos";
import { isAdministrative } from "@/server/auth/roles";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser("/admin/projects/new");
  const canManageVideos = isAdministrative(user.role);
  const [categories, media, readyVideos] = await Promise.all([
    prisma.portfolioCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    prisma.media.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, originalName: true, altText: true },
    }),
    canManageVideos
      ? prisma.video.findMany({
          where: { status: "READY" },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: PROJECT_VIDEO_OPTION_LIMIT,
          select: PROJECT_VIDEO_OPTION_SELECT,
        })
      : Promise.resolve([]),
  ]);
  const { error } = await searchParams;
  return (
    <AdminShell user={user} title="New project">
      <Notice message={error} />
      <ProjectForm
        categories={categories}
        media={media}
        videos={buildProjectFormVideos(canManageVideos, [], readyVideos)}
      />
    </AdminShell>
  );
}
