import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { MediaImage } from "@/components/public/media-image";
import { ProjectGallery } from "@/components/public/project-gallery";
import { VideoPlayer } from "@/components/public/video-player";
import { Container } from "@/components/ui/container";
import { buildPublicMetadata } from "@/server/public/metadata";
import {
  getPublishedProjectBySlug,
  getPublishedProjectSlugs,
} from "@/server/public/queries";

type ProjectPageProps = { params: Promise<{ slug: string }> };

// Next.js requires a literal here. Keep it equal to PUBLIC_REVALIDATE_SECONDS
// in src/server/public/cache-tags.ts, which is the documented safety net;
// admin saves invalidate by tag long before this elapses.
export const revalidate = 3600;

/**
 * Published projects are pre-rendered at build time and revalidated by tag
 * when an administrator saves. `dynamicParams` stays at its default, so a
 * project published after the build is still rendered on demand and then
 * cached — new work appears without a redeploy.
 *
 * Note that no `loading.tsx` may sit above this route: a streaming boundary
 * commits a 200 before `notFound()` runs, which would turn every draft and
 * unknown slug into a soft 404 (ADR 0005).
 */
export async function generateStaticParams() {
  const slugs = await getPublishedProjectSlugs();

  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: ProjectPageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = await getPublishedProjectBySlug(slug);

  if (!project) return {};

  return buildPublicMetadata({
    title: project.seoTitle ?? project.title,
    description: project.seoDescription ?? project.summary,
    path: `/work/${project.slug}`,
    imageUrl: project.shareImageUrl,
  });
}

/**
 * Public project detail.
 *
 * A draft project and a slug that never existed are indistinguishable here:
 * the query only matches published projects in active categories, so both
 * produce the same 404 and the page never hints that a draft exists.
 */
export default async function ProjectPage({ params }: ProjectPageProps) {
  const { slug } = await params;
  const project = await getPublishedProjectBySlug(slug);

  if (!project) notFound();

  const [cover, ...gallery] = project.gallery;

  const facts = [
    { label: "Category", value: project.category.name },
    { label: "Client", value: project.clientName },
    { label: "Location", value: project.location },
    { label: "Date", value: project.dateLabel },
  ].filter((fact): fact is { label: string; value: string } =>
    Boolean(fact.value),
  );

  return (
    <main id="main-content">
      <Container>
        <FadeReveal className="pt-12 sm:pt-20 lg:pt-28">
          <p className="text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
            {project.category.name}
          </p>
          <h1 className="editorial-balance mt-5 max-w-4xl font-display text-[clamp(2.75rem,7.5vw,8rem)] leading-[0.86] font-medium tracking-[-0.04em]">
            {project.title}
          </h1>
          <p className="mt-8 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
            {project.summary}
          </p>
        </FadeReveal>
      </Container>

      {cover ? (
        <Container className="mt-12 sm:mt-16">
          <FadeReveal>
            <MediaImage
              image={cover}
              priority
              sizes="(min-width: 1600px) 1400px, 100vw"
            />
          </FadeReveal>
        </Container>
      ) : null}

      <Container>
        <div className="grid gap-12 py-20 sm:py-24 lg:grid-cols-12 lg:gap-x-8 lg:py-32">
          {facts.length ? (
            <FadeReveal className="lg:col-span-4">
              <dl className="grid gap-5 border-t border-border pt-6">
                {facts.map((fact) => (
                  <div key={fact.label}>
                    <dt className="text-[0.625rem] tracking-[0.15em] text-muted-foreground uppercase">
                      {fact.label}
                    </dt>
                    <dd className="mt-1 text-sm">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </FadeReveal>
          ) : null}

          <FadeReveal
            className={facts.length ? "lg:col-span-7 lg:col-start-6" : "lg:col-span-8"}
          >
            {project.description.map((paragraph) => (
              <p
                className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground first:mt-0 sm:text-base sm:leading-8"
                key={paragraph.slice(0, 48)}
              >
                {paragraph}
              </p>
            ))}
          </FadeReveal>
        </div>

        {project.video ? (
          <section aria-labelledby="project-video-title" className="pb-20 sm:pb-28">
            <h2
              className="text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase"
              id="project-video-title"
            >
              Film
            </h2>
            <VideoPlayer
              className="mt-8"
              fallbackLabel={`the ${project.title} film`}
              video={project.video}
            />
          </section>
        ) : null}

        {gallery.length ? (
          <section aria-label={`${project.title} gallery`} className="pb-24 sm:pb-32">
            <ProjectGallery images={gallery} />
          </section>
        ) : null}

        <FadeReveal className="border-t border-border py-14 sm:py-20">
          <Link
            className="inline-flex min-h-12 items-center text-[0.6875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase transition-colors hover:text-foreground"
            href="/work"
          >
            Back to all work
          </Link>
        </FadeReveal>
      </Container>
    </main>
  );
}
