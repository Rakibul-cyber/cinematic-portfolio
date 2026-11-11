import { AdminShell, Notice } from "@/components/admin/admin-shell";
import { ProjectForm } from "@/components/admin/project-form";
import { PROJECT_MEDIA_OPTION_SELECT, toProjectMediaOption } from "@/lib/cms/project-media";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
import { mediaUrl } from "@/server/media/r2";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser("/admin/projects/new");
  const media = await prisma.media.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: PROJECT_MEDIA_OPTION_SELECT,
  });
  const { error } = await searchParams;
  return (
    <AdminShell user={user} title="New project">
      <Notice message={error} />
      <ProjectForm media={media.map((item) => toProjectMediaOption(item, mediaUrl))} />
    </AdminShell>
  );
}
