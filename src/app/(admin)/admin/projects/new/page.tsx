import { AdminShell, Notice } from "@/components/admin/admin-shell";
import { ProjectForm } from "@/components/admin/project-form";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser("/admin/projects/new");
  const [categories, media] = await Promise.all([
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
  ]);
  const { error } = await searchParams;
  return (
    <AdminShell user={user} title="New project">
      <Notice message={error} />
      <ProjectForm categories={categories} media={media} />
    </AdminShell>
  );
}
