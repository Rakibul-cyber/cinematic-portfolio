import type { Metadata } from "next";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { CategoryFilter } from "@/components/public/category-filter";
import { PageIntro } from "@/components/public/page-intro";
import { ProjectCard } from "@/components/public/project-card";
import { Container } from "@/components/ui/container";
import { emptyStates } from "@/content/site";
import { cn } from "@/lib/utils";
import { buildPublicMetadata } from "@/server/public/metadata";
import { getPublicCategories, getPublishedProjects } from "@/server/public/queries";

type WorkPageProps = {
  searchParams: Promise<{ category?: string | string[] }>;
};

export function generateMetadata(): Promise<Metadata> {
  return buildPublicMetadata({
    title: "Work",
    description: "Selected photography and film projects.",
    path: "/work",
  });
}

/**
 * Public work index.
 *
 * Rendered per request because it accepts a category filter, but both queries
 * behind it are cached and tagged, so a request without a cache-invalidating
 * admin save costs no database round trip.
 *
 * Only published projects in active categories are ever fetched; the filter
 * narrows an already-safe result rather than being the thing that hides drafts.
 */
export default async function WorkPage({ searchParams }: WorkPageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.category)
    ? params.category[0]
    : params.category;

  const categories = await getPublicCategories();

  // An unknown or inactive slug is treated as no filter at all rather than as
  // a 404, so a stale bookmark still lands on the full portfolio.
  const activeSlug =
    categories.find((category) => category.slug === requested)?.slug ?? null;

  const visible = await getPublishedProjects(
    activeSlug ? { categorySlug: activeSlug } : undefined,
  );

  return (
    <main id="main-content">
      <PageIntro eyebrow="Portfolio" title="Work" />

      <Container>
        <FadeReveal className="border-t border-border pt-6">
          <CategoryFilter activeSlug={activeSlug} categories={categories} />
        </FadeReveal>

        {visible.length === 0 ? (
          <p className="py-24 text-sm leading-7 text-muted-foreground sm:py-32">
            {emptyStates.work}
          </p>
        ) : (
          <div className="mt-14 grid gap-x-6 gap-y-14 pb-24 md:grid-cols-2 lg:mt-20 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-24 lg:pb-32">
            {visible.map((project, index) => {
              // Alternating rhythm: one wide card opening each group of three.
              const isWide = index % 3 === 0;

              return (
                <FadeReveal
                  className={cn(
                    isWide ? "md:col-span-2 lg:col-span-7" : "lg:col-span-5",
                    index % 3 === 2 && "lg:col-start-7",
                  )}
                  delay={Math.min(index % 3, 2) * 0.05}
                  key={project.slug}
                >
                  <ProjectCard
                    layout={isWide ? "wide" : "portrait"}
                    priority={index === 0}
                    project={project}
                  />
                </FadeReveal>
              );
            })}
          </div>
        )}
      </Container>
    </main>
  );
}
