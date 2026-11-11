import Link from "next/link";

import { MediaImage } from "@/components/public/media-image";
import { cn } from "@/lib/utils";
import type { PublicProjectSummary } from "@/server/public/view-models";

type ProjectCardProps = {
  project: PublicProjectSummary;
  /** Wide cards span more of the grid, so they need a larger candidate. */
  layout?: "wide" | "portrait";
  className?: string;
  priority?: boolean;
  /** Outline level of the title: 3 under a section heading, 2 directly under the page h1. */
  headingLevel?: 2 | 3;
};

const RATIO = {
  wide: "aspect-[16/10]",
  portrait: "aspect-[4/5]",
} as const;

/**
 * One project in an editorial grid.
 *
 * The whole card is a single link, so there is exactly one tab stop and the
 * accessible name is the project title rather than a bare "read more".
 */
export function ProjectCard({
  className,
  headingLevel = 3,
  layout = "portrait",
  priority = false,
  project,
}: ProjectCardProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <article className={cn("work-card group", className)}>
      <Link className="block focus-visible:outline-offset-8" href={`/work/${project.slug}`}>
        {project.cover ? (
          <MediaImage
            className={cn("work-card-visual w-full", RATIO[layout])}
            image={project.cover}
            priority={priority}
            ratioClassName={RATIO[layout]}
            sizes={
              layout === "wide"
                ? "(min-width: 1024px) 58vw, (min-width: 768px) 92vw, 100vw"
                : "(min-width: 1024px) 40vw, (min-width: 768px) 46vw, 100vw"
            }
          />
        ) : (
          <div
            aria-hidden="true"
            className={cn("work-card-visual w-full bg-surface", RATIO[layout])}
          />
        )}

        <div className="mt-5 flex items-start justify-between gap-6 border-t border-border pt-4">
          <div>
            <Heading className="font-display text-2xl font-medium transition-colors group-hover:text-accent sm:text-3xl">
              {project.title}
            </Heading>
          </div>
          {project.year ? (
            <p className="pt-2 text-[0.5625rem] tracking-[0.14em] text-muted-foreground uppercase">
              {project.year}
            </p>
          ) : null}
        </div>
      </Link>
    </article>
  );
}
