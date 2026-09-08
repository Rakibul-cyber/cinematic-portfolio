import { notFound } from "next/navigation";
import { AdminShell, Notice } from "@/components/admin/admin-shell";
import { ProjectForm } from "@/components/admin/project-form";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
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
  const [project, categories, media] = await Promise.all([
    prisma.project.findUnique({
      where: { id },
      include: {
        media: { orderBy: { sortOrder: "asc" }, select: { mediaId: true } },
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
  ]);
  if (!project) notFound();
  const { error } = await searchParams;
  return (
    <AdminShell user={user} title="Edit project">
      <Notice message={error} />
      <ProjectForm project={project} categories={categories} media={media} />
    </AdminShell>
  );
}
