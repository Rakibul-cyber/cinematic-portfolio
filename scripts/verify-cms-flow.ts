// Must stay first: refuses a non-approved database before anything can connect.
import "./lib/require-non-production-database";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AdminRole } from "@/generated/prisma/enums";
import {
  categorySchema,
  pageSchema,
  projectSchema,
  serviceSchema,
  settingsSchema,
  socialSchema,
  testimonialSchema,
} from "@/lib/validation/cms";
import {
  deleteCategory,
  deleteProject,
  deleteSimple,
  saveCategory,
  savePage,
  saveProject,
  saveService,
  saveSettings,
  saveSocial,
  saveTestimonial,
  ProjectConflictError,
  SlugConflictError,
} from "@/server/cms/service";
import { prisma } from "@/server/db/prisma";
import { deleteMedia, MediaInUseError } from "@/server/media/service";

async function main() {
  const token = randomUUID();
  const [previousPage, previousSettings] = await Promise.all([
    prisma.page.findUnique({ where: { key: "about" } }),
    prisma.siteSetting.findUnique({ where: { id: "primary" } }),
  ]);
  const actor = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: "CMS verifier",
      email: `cms-${token}@invalid.example`,
      role: AdminRole.EDITOR,
    },
    select: { id: true, name: true, email: true, role: true },
  });
  let categoryId = "",
    projectId = "",
    mediaId = "",
    raceMediaId = "",
    serviceId = "",
    testimonialId = "",
    socialId = "";
  try {
    const category = await saveCategory(
      categorySchema.parse({
        name: "Verification",
        slug: `verify-${token}`,
        description: "",
        sortOrder: 2,
        isActive: true,
      }),
      actor,
    );
    categoryId = category.id;
    await assert.rejects(
      () =>
        saveCategory(
          categorySchema.parse({
            name: "Duplicate",
            slug: `verify-${token}`,
            description: "",
            sortOrder: 3,
            isActive: true,
          }),
          actor,
        ),
      SlugConflictError,
    );
    const media = await prisma.media.create({
      data: {
        originalName: "verification.webp",
        mimeType: "image/webp",
        sizeBytes: 1,
        width: 1,
        height: 1,
        bucket: "verification",
        objectKey: `verification/${token}.webp`,
        createdByUserId: actor.id,
      },
    });
    mediaId = media.id;
    const project = await saveProject(
      projectSchema.parse({
        title: "Verification project",
        slug: `project-${token}`,
        summary: "Summary",
        description: "Description",
        clientName: "",
        location: "",
        projectDate: "",
        categoryId,
        status: "DRAFT",
        featured: false,
        sortOrder: 1,
        seoTitle: "",
        seoDescription: "",
        mediaIds: [mediaId],
      }),
      actor,
    );
    projectId = project.id;
    const projectUpdate = {
      id: projectId,
      expectedUpdatedAt: project.updatedAt,
      title: "Updated project",
      slug: `project-${token}`,
      summary: "Summary",
      description: "Description",
      clientName: "",
      location: "",
      projectDate: "",
      categoryId,
      status: "PUBLISHED",
      featured: true,
      sortOrder: 1,
      seoTitle: "",
      seoDescription: "",
      mediaIds: [mediaId],
    };
    await saveProject(projectSchema.parse(projectUpdate), actor);
    assert.equal(
      (await prisma.project.findUnique({ where: { id: projectId } }))?.status,
      "PUBLISHED",
    );
    // A media-only edit carrying the now-stale version must not land.
    await assert.rejects(
      () =>
        saveProject(projectSchema.parse({ ...projectUpdate, mediaIds: [] }), actor),
      ProjectConflictError,
    );
    assert.equal(
      await prisma.projectMedia.count({ where: { projectId } }),
      1,
    );
    // Two saves racing on one version: exactly one may land, whichever it is.
    // Both keep `mediaId` attached so the in-use check below stays meaningful.
    const raceMedia = await prisma.media.create({
      data: {
        originalName: "verification-race.webp",
        mimeType: "image/webp",
        sizeBytes: 1,
        width: 1,
        height: 1,
        bucket: "verification",
        objectKey: `verification/${token}-race.webp`,
        createdByUserId: actor.id,
      },
    });
    raceMediaId = raceMedia.id;
    const { updatedAt: raceVersion } = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { updatedAt: true },
    });
    const contenders = [
      { title: "Race A", mediaIds: [mediaId, raceMediaId] },
      { title: "Race B", mediaIds: [raceMediaId, mediaId] },
    ];
    const outcomes = await Promise.allSettled(
      contenders.map((contender) =>
        saveProject(
          projectSchema.parse({
            ...projectUpdate,
            ...contender,
            expectedUpdatedAt: raceVersion,
          }),
          actor,
        ),
      ),
    );
    const winners = outcomes.flatMap((outcome, index) =>
      outcome.status === "fulfilled" ? [contenders[index]] : [],
    );
    const losers = outcomes.flatMap((outcome) =>
      outcome.status === "rejected" ? [outcome.reason] : [],
    );
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.ok(losers[0] instanceof ProjectConflictError);
    const raced = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { media: { orderBy: { sortOrder: "asc" } } },
    });
    assert.equal(raced.title, winners[0].title);
    assert.ok(raced.updatedAt.getTime() > raceVersion.getTime());
    assert.deepEqual(
      raced.media.map(({ mediaId, sortOrder, role }) => ({
        mediaId,
        sortOrder,
        role,
      })),
      winners[0].mediaIds.map((id, index) => ({
        mediaId: id,
        sortOrder: index,
        role: index === 0 ? "COVER" : "GALLERY",
      })),
    );
    await assert.rejects(() => deleteMedia(mediaId, actor), MediaInUseError);
    const service = await saveService(
      serviceSchema.parse({
        name: "Service",
        slug: `service-${token}`,
        shortDescription: "Short",
        description: "Long",
        priceLabel: "From EUR 1",
        sortOrder: 2,
        isActive: true,
      }),
      actor,
    );
    serviceId = service.id;
    await saveService(
      serviceSchema.parse({
        id: service.id,
        name: "Updated service",
        slug: service.slug,
        shortDescription: service.shortDescription,
        description: service.description,
        priceLabel: service.priceLabel ?? "",
        sortOrder: service.sortOrder,
        isActive: service.isActive,
      }),
      actor,
    );
    const testimonial = await saveTestimonial(
      testimonialSchema.parse({
        quote: "Quote",
        authorName: "Author",
        authorRole: "",
        company: "",
        projectName: "",
        sortOrder: 2,
        isActive: true,
      }),
      actor,
    );
    testimonialId = testimonial.id;
    await saveTestimonial(
      testimonialSchema.parse({
        id: testimonial.id,
        quote: "Updated quote",
        authorName: testimonial.authorName,
        authorRole: "",
        company: "",
        projectName: "",
        sortOrder: 2,
        isActive: true,
      }),
      actor,
    );
    await savePage(
      pageSchema.parse({
        key: "about",
        title: "About",
        eyebrow: "",
        body: "Body",
        seoTitle: "",
        seoDescription: "",
      }),
      actor,
    );
    await saveSettings(
      settingsSchema.parse({
        studioName: "Verification Studio",
        tagline: "",
        contactEmail: "",
        contactPhone: "",
        whatsappNumber: "",
        locationText: "",
        footerCopyright: "",
        defaultSeoTitle: "",
        defaultSeoDescription: "",
      }),
      actor,
    );
    const social = await saveSocial(
      socialSchema.parse({
        platform: "Instagram",
        label: "Instagram",
        url: "https://example.com",
        sortOrder: 2,
        isActive: true,
      }),
      actor,
    );
    socialId = social.id;
    assert.ok(
      await prisma.auditLog.findFirst({
        where: { actorUserId: actor.id, entityType: "project" },
      }),
    );
    await deleteProject(projectId, actor);
    projectId = "";
    assert.ok(await prisma.media.findUnique({ where: { id: mediaId } }));
    await deleteSimple("service", serviceId, actor);
    serviceId = "";
    await deleteSimple("testimonial", testimonialId, actor);
    testimonialId = "";
    await deleteSimple("socialLink", socialId, actor);
    socialId = "";
    await deleteCategory(categoryId, actor);
    categoryId = "";
    console.log(
      "Live CMS verification passed: CRUD, publishing, slug conflict, ordering, media reference protection, preservation, and audit.",
    );
  } finally {
    if (projectId)
      await prisma.project.deleteMany({ where: { id: projectId } });
    if (mediaId) await prisma.media.deleteMany({ where: { id: mediaId } });
    if (raceMediaId)
      await prisma.media.deleteMany({ where: { id: raceMediaId } });
    if (categoryId)
      await prisma.portfolioCategory.deleteMany({ where: { id: categoryId } });
    if (serviceId)
      await prisma.service.deleteMany({ where: { id: serviceId } });
    if (testimonialId)
      await prisma.testimonial.deleteMany({ where: { id: testimonialId } });
    if (socialId)
      await prisma.socialLink.deleteMany({ where: { id: socialId } });
    if (previousPage) {
      const data = { id: previousPage.id, key: previousPage.key, title: previousPage.title, eyebrow: previousPage.eyebrow, body: previousPage.body, seoTitle: previousPage.seoTitle, seoDescription: previousPage.seoDescription };
      await prisma.page.upsert({
        where: { key: "about" },
        create: data,
        update: data,
      });
    } else await prisma.page.deleteMany({ where: { key: "about" } });
    if (previousSettings) {
      const data = { id: previousSettings.id, studioName: previousSettings.studioName, tagline: previousSettings.tagline, contactEmail: previousSettings.contactEmail, contactPhone: previousSettings.contactPhone, whatsappNumber: previousSettings.whatsappNumber, locationText: previousSettings.locationText, footerCopyright: previousSettings.footerCopyright, defaultSeoTitle: previousSettings.defaultSeoTitle, defaultSeoDescription: previousSettings.defaultSeoDescription };
      await prisma.siteSetting.upsert({
        where: { id: "primary" },
        create: data,
        update: data,
      });
    } else await prisma.siteSetting.deleteMany({ where: { id: "primary" } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: actor.id } });
    await prisma.user.delete({ where: { id: actor.id } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "CMS verification failed",
  );
  process.exitCode = 1;
});
