import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";
export default async function AdminHomePage() {
  const user = await requireUser("/admin");
  const [projects, published, media, services, testimonials, newInquiries, openInquiries] =
    await Promise.all([
      prisma.project.count(),
      prisma.project.count({ where: { status: "PUBLISHED" } }),
      prisma.media.count(),
      prisma.service.count(),
      prisma.testimonial.count(),
      prisma.inquiry.count({where:{status:"NEW"}}),
      prisma.inquiry.count({where:{status:{notIn:["COMPLETED","CANCELLED"]}}}),
    ]);
  const metrics = [
    ["Projects", projects],
    ["Published", published],
    ["Drafts", projects - published],
    ["Media", media],
    ["Services", services],
    ["Testimonials", testimonials],
    ["New inquiries", newInquiries],
    ["Open inquiries", openInquiries],
  ];
  return (
    <AdminShell user={user} title="Dashboard">
      <dl className="grid gap-px bg-border sm:grid-cols-3">
        {metrics.map(([label, value]) => (
          <div className="bg-surface p-5" key={label}>
            <dt className="text-xs uppercase text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-3xl">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          className="bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
          href="/admin/projects/new"
        >
          New project
        </Link>
        <Link
          className="border border-border px-5 py-3 text-sm"
          href="/admin/media"
        >
          Upload media
        </Link>
        <Link
          className="border border-border px-5 py-3 text-sm"
          href="/admin/services"
        >
          Add service
        </Link>
        <Link
          className="border border-border px-5 py-3 text-sm"
          href="/admin/testimonials"
        >
          Add testimonial
        </Link>
      </div>
    </AdminShell>
  );
}
