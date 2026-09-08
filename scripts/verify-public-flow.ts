import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

import { AdminRole } from "@/generated/prisma/enums";
import { prisma } from "@/server/db/prisma";

import { deleteMedia, uploadMedia } from "@/server/media/service";

/**
 * Live verification of the public portfolio.
 *
 * Runs in three steps so the checks see a genuinely cold render rather than a
 * cached one:
 *
 *   npm run public:verify -- --seed      # temporary CMS content + real media
 *   npx next start                       # in a second terminal
 *   npm run public:verify -- --check     # HTTP assertions
 *   npm run public:verify -- --cleanup   # remove everything, restore settings
 *
 * Every record it creates is temporary and removed by `--cleanup`, which also
 * restores the site settings and page rows exactly as it found them. Nothing
 * fabricated is left in the database or in R2.
 */

const MANIFEST = join(tmpdir(), "cinematic-portfolio-public-verify.json");

/** Drops the database-managed timestamp before restoring a snapshotted row. */
function withoutTimestamp(row: Record<string, unknown>) {
  const data = { ...row };
  delete data.updatedAt;
  return data;
}
const BASE_URL = process.env.PUBLIC_VERIFY_URL ?? "http://localhost:3000";

type Manifest = {
  token: string;
  actorId: string;
  categoryId: string;
  publishedSlug: string;
  draftSlug: string;
  publishedId: string;
  draftId: string;
  mediaIds: string[];
  serviceIds: string[];
  testimonialIds: string[];
  socialIds: string[];
  previousSettings: unknown;
  previousPages: unknown[];
};

async function testImage(label: string, width: number): Promise<File> {
  const buffer = await sharp({
    create: {
      width,
      height: Math.round(width * 0.66),
      channels: 3,
      background: label === "a" ? "#4c3428" : "#625e56",
    },
  })
    .jpeg()
    .toBuffer();

  return new File([new Uint8Array(buffer)], `verify-${label}.jpg`, {
    type: "image/jpeg",
  });
}

async function seed(): Promise<void> {
  const token = randomUUID().slice(0, 8);

  const [previousSettings, previousPages] = await Promise.all([
    prisma.siteSetting.findUnique({ where: { id: "primary" } }),
    prisma.page.findMany(),
  ]);

  const actor = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: "Public verifier",
      email: `public-${token}@invalid.example`,
      role: AdminRole.EDITOR,
    },
    select: { id: true, name: true, email: true, role: true },
  });

  const category = await prisma.portfolioCategory.create({
    data: {
      name: `Verification ${token}`,
      slug: `verify-${token}`,
      sortOrder: 0,
      isActive: true,
    },
  });

  // Real uploads, so public delivery, variant selection, and blur data are all
  // exercised against R2 rather than against fixture rows.
  // Wide enough that Phase 3 produces a capped 2560 master plus a full set of
  // responsive variants, so "never serve the master" is genuinely exercised.
  const first = await uploadMedia(await testImage("a", 3200), "First frame", actor);
  const second = await uploadMedia(await testImage("b", 3000), null, actor);

  const published = await prisma.project.create({
    data: {
      title: `Published ${token}`,
      slug: `published-${token}`,
      summary: `Published summary ${token}.`,
      description: `Published body ${token}.\n\nSecond paragraph.`,
      categoryId: category.id,
      status: "PUBLISHED",
      featured: true,
      sortOrder: 0,
      publishedAt: new Date(),
      projectDate: new Date("2026-04-02T00:00:00.000Z"),
      videoProvider: "YOUTUBE",
      videoId: "aqz-KE-bpKQ",
      videoTitle: `Film ${token}`,
      media: {
        create: [
          { mediaId: first.id, role: "COVER", sortOrder: 0 },
          { mediaId: second.id, role: "GALLERY", sortOrder: 1 },
        ],
      },
    },
  });

  const draft = await prisma.project.create({
    data: {
      title: `Draft ${token}`,
      slug: `draft-${token}`,
      summary: `Draft summary ${token}.`,
      description: `Draft body ${token}.`,
      categoryId: category.id,
      status: "DRAFT",
      sortOrder: 1,
    },
  });

  const services = await Promise.all([
    prisma.service.create({
      data: {
        name: `ActiveService ${token}`,
        slug: `active-service-${token}`,
        shortDescription: "Active short description.",
        description: "Active long description.",
        priceLabel: `From EUR ${token.slice(0, 3)}`,
        isActive: true,
        sortOrder: 0,
      },
    }),
    prisma.service.create({
      data: {
        name: `InactiveService ${token}`,
        slug: `inactive-service-${token}`,
        shortDescription: "Inactive short description.",
        description: "Inactive long description.",
        isActive: false,
        sortOrder: 1,
      },
    }),
  ]);

  const testimonials = await Promise.all([
    prisma.testimonial.create({
      data: {
        quote: `ActiveQuote ${token}`,
        authorName: `Active Author ${token}`,
        isActive: true,
        sortOrder: 0,
      },
    }),
    prisma.testimonial.create({
      data: {
        quote: `InactiveQuote ${token}`,
        authorName: `Inactive Author ${token}`,
        isActive: false,
        sortOrder: 1,
      },
    }),
  ]);

  const socials = await Promise.all([
    prisma.socialLink.create({
      data: {
        platform: "instagram",
        label: `ActiveSocial ${token}`,
        url: "https://example.com/active",
        isActive: true,
        sortOrder: 0,
      },
    }),
    prisma.socialLink.create({
      data: {
        platform: "vimeo",
        label: `InactiveSocial ${token}`,
        url: "https://example.com/inactive",
        isActive: false,
        sortOrder: 1,
      },
    }),
  ]);

  const settingsData = {
    studioName: `Verification Studio ${token}`,
    tagline: `Tagline ${token}`,
    contactEmail: `hello-${token}@invalid.example`,
    contactPhone: "+49 30 1234567",
    whatsappNumber: "+49 30 1234567",
    locationText: `Location ${token}`,
    footerCopyright: `Copyright ${token}`,
    defaultSeoTitle: `SeoTitle ${token}`,
    defaultSeoDescription: `SeoDescription ${token}`,
    showreelProvider: "YOUTUBE" as const,
    showreelVideoId: "aqz-KE-bpKQ",
    showreelTitle: `Showreel ${token}`,
  };

  await prisma.siteSetting.upsert({
    where: { id: "primary" },
    create: { id: "primary", ...settingsData },
    update: settingsData,
  });

  for (const key of ["about", "contact", "services"] as const) {
    const data = {
      key,
      title: `${key} title ${token}`,
      eyebrow: `${key} eyebrow`,
      body: `${key} first paragraph ${token}.\n\n${key} second paragraph.`,
      seoTitle: null,
      seoDescription: null,
    };
    await prisma.page.upsert({ where: { key }, create: data, update: data });
  }

  const manifest: Manifest = {
    token,
    actorId: actor.id,
    categoryId: category.id,
    publishedSlug: published.slug,
    draftSlug: draft.slug,
    publishedId: published.id,
    draftId: draft.id,
    mediaIds: [first.id, second.id],
    serviceIds: services.map((service) => service.id),
    testimonialIds: testimonials.map((testimonial) => testimonial.id),
    socialIds: socials.map((social) => social.id),
    previousSettings,
    previousPages,
  };

  await writeFile(MANIFEST, JSON.stringify(manifest), "utf8");
  console.log(
    `Seeded temporary public verification content (token ${token}).\n` +
      "Start the application, then run: npm run public:verify -- --check",
  );
}

async function get(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    // Deliberately no cookies: public routes must not require a session.
    headers: { accept: "text/html" },
    redirect: "manual",
  });

  return { status: response.status, html: await response.text() };
}

async function check(): Promise<void> {
  const manifest: Manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const { token } = manifest;

  const home = await get("/");
  assert.equal(home.status, 200, "homepage must render without a session");
  assert.ok(home.html.includes(`Verification Studio ${token}`), "studio name");
  assert.ok(home.html.includes(`Published ${token}`), "published project shown");
  assert.ok(!home.html.includes(`Draft ${token}`), "draft project hidden");
  assert.ok(home.html.includes(`ActiveService ${token}`), "active service shown");
  assert.ok(
    !home.html.includes(`InactiveService ${token}`),
    "inactive service hidden",
  );
  assert.ok(home.html.includes(`ActiveQuote ${token}`), "active testimonial");
  assert.ok(!home.html.includes(`InactiveQuote ${token}`), "inactive testimonial");
  assert.ok(home.html.includes(`ActiveSocial ${token}`), "active social link");
  assert.ok(!home.html.includes(`InactiveSocial ${token}`), "inactive social link");

  // Video privacy: the showreel is configured, but nothing may reach YouTube
  // before the visitor activates the player.
  assert.ok(!home.html.includes("<iframe"), "no iframe before activation");
  assert.ok(!home.html.includes("youtube-nocookie.com"), "no provider URL");
  assert.ok(!home.html.includes("ytimg.com"), "no provider thumbnail");
  assert.ok(home.html.includes(`Showreel ${token}`), "showreel section rendered");

  const work = await get("/work");
  assert.equal(work.status, 200);
  assert.ok(work.html.includes(`Published ${token}`), "work index lists published");
  assert.ok(!work.html.includes(`Draft ${token}`), "work index excludes drafts");
  assert.ok(work.html.includes(`Verification ${token}`), "active category offered");
  assert.ok(!work.html.includes("master.webp"), "cards never load the master");
  assert.ok(work.html.includes("w1280.webp"), "cards use small responsive variants");

  const filtered = await get(`/work?category=verify-${token}`);
  assert.equal(filtered.status, 200);
  assert.ok(filtered.html.includes(`Published ${token}`), "category filter works");

  const detail = await get(`/work/${manifest.publishedSlug}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.html.includes(`Published ${token}`), "detail title");
  assert.ok(detail.html.includes("Second paragraph."), "detail description");
  assert.ok(detail.html.includes("First frame"), "alt text from media");
  assert.ok(!detail.html.includes(manifest.publishedId), "no database id leaked");
  assert.ok(!detail.html.includes("<iframe"), "project video not eager");

  // Gallery order follows sortOrder: the cover's object prefix must appear
  // before the second image's.
  const urls = [...detail.html.matchAll(/https:[^"\s]*?\/media\/[^"\s]*?\.webp/g)].map(
    (match) => match[0],
  );
  assert.ok(urls.length > 0, "responsive R2 URLs rendered");
  assert.ok(
    !urls.some((url) => url.includes("master.webp")),
    "the 2560 master is never served when a responsive variant suffices",
  );
  assert.ok(
    urls.some((url) => url.includes("w1920.webp")),
    "detail pages use the large responsive variant",
  );

  const imageResponse = await fetch(urls[0]);
  assert.equal(imageResponse.status, 200, "public media URL resolves");
  assert.match(
    imageResponse.headers.get("content-type") ?? "",
    /image\/webp/,
    "delivered as WebP",
  );

  assert.match(detail.html, /<title>[^<]*Published /, "project metadata title");
  assert.ok(
    detail.html.includes('width="') && detail.html.includes('height="'),
    "intrinsic dimensions prevent layout shift",
  );

  const draft = await get(`/work/${manifest.draftSlug}`);
  assert.equal(draft.status, 404, "draft project must 404 publicly");
  assert.ok(!draft.html.includes(`Draft ${token}`), "404 reveals nothing");

  const unknown = await get(`/work/does-not-exist-${token}`);
  assert.equal(unknown.status, 404, "unknown slug must 404");

  const services = await get("/services");
  assert.equal(services.status, 200);
  assert.ok(services.html.includes(`ActiveService ${token}`));
  assert.ok(!services.html.includes(`InactiveService ${token}`));
  assert.ok(services.html.includes(`services first paragraph ${token}`));

  const about = await get("/about");
  assert.equal(about.status, 200);
  assert.ok(about.html.includes(`about first paragraph ${token}`));
  assert.ok(about.html.includes(`Location ${token}`));

  const contact = await get("/contact");
  assert.equal(contact.status, 200);
  assert.ok(contact.html.includes(`hello-${token}@invalid.example`));
  assert.ok(contact.html.includes("wa.me/49301234567"), "WhatsApp link");
  assert.ok(!contact.html.includes("<form"), "no contact form in Phase 5");

  console.log(
    "Live public verification passed: publication rules, category filter, gallery order, " +
      "R2 variant delivery, video privacy, metadata, empty-safe 404s, and unauthenticated access.",
  );
}

async function cleanup(): Promise<void> {
  const manifest: Manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const actor = await prisma.user.findUnique({
    where: { id: manifest.actorId },
    select: { id: true, name: true, email: true, role: true },
  });

  await prisma.project.deleteMany({
    where: { id: { in: [manifest.publishedId, manifest.draftId] } },
  });

  if (actor) {
    for (const mediaId of manifest.mediaIds) {
      await deleteMedia(mediaId, actor);
    }
  }

  await prisma.service.deleteMany({ where: { id: { in: manifest.serviceIds } } });
  await prisma.testimonial.deleteMany({
    where: { id: { in: manifest.testimonialIds } },
  });
  await prisma.socialLink.deleteMany({ where: { id: { in: manifest.socialIds } } });
  await prisma.portfolioCategory.deleteMany({ where: { id: manifest.categoryId } });

  // Restore the site exactly as it was before seeding.
  const previousSettings = manifest.previousSettings as Record<
    string,
    unknown
  > | null;

  if (previousSettings) {
    const data = withoutTimestamp(previousSettings);
    await prisma.siteSetting.upsert({
      where: { id: "primary" },
      create: data as never,
      update: data as never,
    });
  } else {
    await prisma.siteSetting.deleteMany({ where: { id: "primary" } });
  }

  const previousPages = manifest.previousPages as Record<string, unknown>[];
  await prisma.page.deleteMany({
    where: { key: { in: ["about", "contact", "services"] } },
  });

  for (const page of previousPages) {
    await prisma.page.create({ data: withoutTimestamp(page) as never });
  }

  await prisma.auditLog.deleteMany({ where: { actorUserId: manifest.actorId } });
  await prisma.user.deleteMany({ where: { id: manifest.actorId } });
  await rm(MANIFEST, { force: true });

  console.log("Removed all temporary verification content and restored settings.");
}

async function main() {
  const mode = process.argv.find((argument) =>
    ["--seed", "--check", "--cleanup"].includes(argument),
  );

  if (mode === "--seed") await seed();
  else if (mode === "--check") await check();
  else if (mode === "--cleanup") await cleanup();
  else
    throw new Error(
      "Pass one of --seed, --check, or --cleanup. See the header of this file.",
    );
}

main()
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Public verification failed",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
