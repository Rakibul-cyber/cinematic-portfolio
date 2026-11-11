import type { Metadata } from "next";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { PageIntro } from "@/components/public/page-intro";
import { ProjectCard } from "@/components/public/project-card";
import { JsonLd } from "@/components/seo/json-ld";
import { Container } from "@/components/ui/container";
import { emptyStates } from "@/content/site";
import { cn } from "@/lib/utils";
import { buildPublicMetadata } from "@/server/public/metadata";
import { getPublishedProjects } from "@/server/public/queries";
import { breadcrumbStructuredData } from "@/server/seo/structured-data";

// Mirrors PUBLIC_REVALIDATE_SECONDS; Next.js requires a literal here.
export const revalidate = 3600;

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
 * Every published project, in the curated order. The query is cached and
 * tagged, so an admin save shows here on the next request. Only published
 * projects are ever fetched. There is no category filter (MH-15); an old
 * `/work?category=...` link simply shows the whole portfolio.
 */
export default async function WorkPage() {
  const visible = await getPublishedProjects();

  const structuredData = await breadcrumbStructuredData([
    { name: "Home", path: "/" },
    { name: "Work", path: "/work" },
  ]);

  return (
    <main id="main-content">
      <PageIntro eyebrow="Portfolio" title="Work" />

      <Container>
        <div className="border-t border-border pt-6" />

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
                    headingLevel={2}
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

      <JsonLd nodes={structuredData} />
    </main>
  );
}
