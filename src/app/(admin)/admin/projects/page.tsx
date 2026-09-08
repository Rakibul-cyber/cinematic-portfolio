import Link from "next/link";
import { deleteAction } from "@/app/(admin)/admin/cms-actions";
import { DeleteButton } from "@/components/admin/delete-button";
import { AdminShell, Notice } from "@/components/admin/admin-shell";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser("/admin/projects");
  const rows = await prisma.project.findMany({
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      featured: true,
      updatedAt: true,
      category: { select: { name: true } },
    },
  });
  const { error } = await searchParams;
  return (
    <AdminShell user={user} title="Projects">
      <Notice message={error} />
      <Link
        href="/admin/projects/new"
        className="inline-block bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
      >
        New project
      </Link>
      <ul className="mt-6 grid gap-3">
        {rows.length ? (
          rows.map((r) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 border border-border p-4"
              key={r.id}
            >
              <div>
                <Link
                  className="font-medium underline"
                  href={`/admin/projects/${r.id}`}
                >
                  {r.title}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {r.category.name} · {r.status} ·{" "}
                  {r.featured ? "Featured · " : ""}
                  {r.updatedAt.toLocaleDateString()}
                </p>
              </div>
              <form action={deleteAction}>
                <input type="hidden" name="kind" value="project" />
                <input type="hidden" name="id" value={r.id} />
                <DeleteButton />
              </form>
            </li>
          ))
        ) : (
          <li>No projects yet.</li>
        )}
      </ul>
    </AdminShell>
  );
}
