import Link from "next/link";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { ProjectCard } from "@/components/public/project-card";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { sectionLabels } from "@/content/site";
import { cn } from "@/lib/utils";
import type { PublicProjectSummary } from "@/server/public/view-models";

type FeaturedWorkSectionProps = {
  projects: readonly PublicProjectSummary[];
};

/**
 * Selected work on the homepage.
 *
 * Published projects only — the section is omitted entirely when none exist,
 * so an empty CMS shortens the page instead of showing an empty grid or an
 * administrative message.
 *
 * The first card is wide and the rest alternate, which keeps the editorial
 * rhythm without any per-project layout field in the CMS.
 */
export function FeaturedWorkSection({ projects }: FeaturedWorkSectionProps) {
  if (projects.length === 0) return null;

  return (
    <section
      aria-labelledby="featured-work-title"
      className="scroll-mt-20 border-t border-border py-24 sm:py-32 lg:py-40"
      id="selected-work"
    >
      <Container>
        <FadeReveal>
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <SectionHeading
              className="lg:col-span-8"
              eyebrow={sectionLabels.selectedWork}
              title="Recent projects"
              titleId="featured-work-title"
            />
            <Link
              className="inline-flex min-h-12 items-center text-[0.6875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase transition-colors hover:text-foreground lg:col-span-4 lg:justify-self-end"
              href="/work"
            >
              All work
            </Link>
          </div>
        </FadeReveal>

        <div className="mt-16 grid gap-x-6 gap-y-14 md:grid-cols-2 lg:mt-24 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-24">
          {projects.map((project, index) => {
            const isWide = index === 0;

            return (
              <FadeReveal
                className={cn(
                  isWide ? "md:col-span-2 lg:col-span-7" : "lg:col-span-5",
                  index === 2 && "lg:col-start-7",
                )}
                delay={Math.min(index, 3) * 0.05}
                key={project.slug}
              >
                <ProjectCard
                  layout={isWide ? "wide" : "portrait"}
                  project={project}
                />
              </FadeReveal>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
