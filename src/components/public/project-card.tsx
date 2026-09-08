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
  layout = "portrait",
  priority = false,
  project,
}: ProjectCardProps) {
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
            <h3 className="font-display text-2xl font-medium transition-colors group-hover:text-accent sm:text-3xl">
              {project.title}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {project.category.name}
            </p>
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
