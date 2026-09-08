import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { z } from "zod";
import type {
  categorySchema,
  pageSchema,
  projectSchema,
  serviceSchema,
  settingsSchema,
  socialSchema,
  testimonialSchema,
} from "@/lib/validation/cms";
import { AuditAction, recordAuditLog } from "@/server/audit/audit-log";
import type { AdminUser } from "@/server/auth/session";
import { prisma } from "@/server/db/prisma";

type Input<T extends z.ZodType> = z.infer<T>;
export class SlugConflictError extends Error {}
export class ReferencedCategoryError extends Error {}

async function audit(
  actor: AdminUser,
  action: string,
  entityType: string,
  entityId?: string,
) {
  await recordAuditLog({
    action,
    entityType,
    entityId,
    actorUserId: actor.id,
    actorEmail: actor.email,
  });
}
function translate(error: unknown, label: string): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  )
    throw new SlugConflictError(`A ${label} with this slug already exists.`);
  throw error;
}

export async function saveCategory(
  data: Input<typeof categorySchema>,
  actor: AdminUser,
) {
  try {
    const { id, ...fields } = data;
    const row = id
      ? await prisma.portfolioCategory.update({ where: { id }, data: fields })
      : await prisma.portfolioCategory.create({ data: fields });
    await audit(
      actor,
      id ? AuditAction.CmsUpdated : AuditAction.CmsCreated,
      "category",
      row.id,
    );
    return row;
  } catch (error) {
    translate(error, "category");
  }
}
export async function deleteCategory(id: string, actor: AdminUser) {
  if (await prisma.project.count({ where: { categoryId: id } }))
    throw new ReferencedCategoryError(
      "Move or delete projects in this category first.",
    );
  await prisma.portfolioCategory.delete({ where: { id } });
  await audit(actor, AuditAction.CmsDeleted, "category", id);
}
export async function saveService(
  data: Input<typeof serviceSchema>,
  actor: AdminUser,
) {
  try {
    const { id, ...fields } = data;
    const row = id
      ? await prisma.service.update({ where: { id }, data: fields })
      : await prisma.service.create({ data: fields });
    await audit(
      actor,
      id ? AuditAction.CmsUpdated : AuditAction.CmsCreated,
      "service",
      row.id,
    );
    return row;
  } catch (error) {
    translate(error, "service");
  }
}
export async function saveTestimonial(
  data: Input<typeof testimonialSchema>,
  actor: AdminUser,
) {
  const { id, ...fields } = data;
  const row = id
    ? await prisma.testimonial.update({ where: { id }, data: fields })
    : await prisma.testimonial.create({ data: fields });
  await audit(
    actor,
    id ? AuditAction.CmsUpdated : AuditAction.CmsCreated,
    "testimonial",
    row.id,
  );
  return row;
}
export async function savePage(
  data: Input<typeof pageSchema>,
  actor: AdminUser,
) {
  const fields = { key: data.key, title: data.title, eyebrow: data.eyebrow, body: data.body, seoTitle: data.seoTitle, seoDescription: data.seoDescription };
  const row = await prisma.page.upsert({
    where: { key: fields.key },
    create: fields,
    update: fields,
  });
  await audit(actor, AuditAction.CmsUpdated, "page", row.id);
  return row;
}
export async function saveSettings(
  data: Input<typeof settingsSchema>,
  actor: AdminUser,
) {
  await prisma.siteSetting.upsert({
    where: { id: "primary" },
    create: { id: "primary", ...data },
    update: data,
  });
  await audit(actor, AuditAction.CmsUpdated, "settings", "primary");
}
export async function saveSocial(
  data: Input<typeof socialSchema>,
  actor: AdminUser,
) {
  const { id, ...fields } = data;
  const row = id
    ? await prisma.socialLink.update({ where: { id }, data: fields })
    : await prisma.socialLink.create({ data: fields });
  await audit(
    actor,
    id ? AuditAction.CmsUpdated : AuditAction.CmsCreated,
    "social_link",
    row.id,
  );
  return row;
}
export async function deleteSimple(
  kind: "service" | "testimonial" | "socialLink",
  id: string,
  actor: AdminUser,
) {
  if (kind === "service") await prisma.service.delete({ where: { id } });
  else if (kind === "testimonial")
    await prisma.testimonial.delete({ where: { id } });
  else await prisma.socialLink.delete({ where: { id } });
  await audit(actor, AuditAction.CmsDeleted, kind, id);
}
export async function saveProject(
  data: Input<typeof projectSchema>,
  actor: AdminUser,
) {
  try {
    const { id, mediaIds, ...fields } = data;
    const publishedAt = fields.status === "PUBLISHED" ? new Date() : null;
    const row = await prisma.$transaction(async (tx) => {
      const project = id
        ? await tx.project.update({
            where: { id },
            data: { ...fields, publishedAt },
          })
        : await tx.project.create({ data: { ...fields, publishedAt } });
      await tx.projectMedia.deleteMany({ where: { projectId: project.id } });
      if (mediaIds.length)
        await tx.projectMedia.createMany({
          data: mediaIds.map((mediaId, index) => ({
            projectId: project.id,
            mediaId,
            sortOrder: index,
            role: index === 0 ? "COVER" : "GALLERY",
          })),
        });
      return project;
    });
    await audit(
      actor,
      id ? AuditAction.CmsUpdated : AuditAction.CmsCreated,
      "project",
      row.id,
    );
    await audit(
      actor,
      fields.status === "PUBLISHED"
        ? AuditAction.ProjectPublished
        : AuditAction.ProjectUnpublished,
      "project",
      row.id,
    );
    return row;
  } catch (error) {
    translate(error, "project");
  }
}
export async function deleteProject(id: string, actor: AdminUser) {
  await prisma.project.delete({ where: { id } });
  await audit(actor, AuditAction.CmsDeleted, "project", id);
}
