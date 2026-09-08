import Link from "next/link";
import { ArrowDown } from "lucide-react";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { MediaImage } from "@/components/public/media-image";
import { Container } from "@/components/ui/container";
import { FALLBACK_STUDIO_NAME } from "@/content/site";
import type {
  PublicProjectSummary,
  PublicSiteSettings,
} from "@/server/public/view-models";

type HeroSectionProps = {
  settings: PublicSiteSettings | null;
  /** Featured project supplying the hero image, when one exists. */
  hero: PublicProjectSummary | null;
};

/**
 * Homepage hero.
 *
 * Rather than introducing a separate global hero-media model, the hero reuses
 * the existing featured/cover concept: the first featured published project
 * supplies the image, and its cover is the page's LCP element, so it is the
 * one image on the site loaded eagerly at high priority.
 *
 * Wording comes from site settings. With no settings saved the section still
 * renders a composed, typographic hero rather than placeholder studio copy.
 */
export function HeroSection({ hero, settings }: HeroSectionProps) {
  const studioName = settings?.studioName ?? FALLBACK_STUDIO_NAME;
  const headline = settings?.tagline ?? studioName;

  return (
    <section aria-labelledby="hero-title" className="relative pb-20" id="top">
      <Container className="grid min-h-[calc(100svh-var(--header-height))] grid-rows-[auto_1fr_auto] gap-10 py-10 sm:py-14 lg:grid-cols-12 lg:grid-rows-[1fr_auto] lg:gap-x-8 lg:py-16">
        <FadeReveal className="relative z-10 self-center lg:col-span-7 lg:row-start-1">
          {settings?.tagline ? (
            <p className="mb-5 text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
              {studioName}
            </p>
          ) : null}
          <h1
            className="editorial-balance max-w-5xl font-display text-[clamp(3.25rem,10vw,10.5rem)] leading-[0.82] font-medium tracking-[-0.045em]"
            id="hero-title"
          >
            {headline}
          </h1>
          <div className="mt-8 flex max-w-2xl flex-col items-start gap-7 sm:flex-row sm:items-end sm:justify-between lg:mt-10">
            {settings?.defaultSeoDescription ? (
              <p className="max-w-md text-sm leading-7 text-muted-foreground sm:text-base">
                {settings.defaultSeoDescription}
              </p>
            ) : null}
            <Link
              className="group inline-flex min-h-12 items-center justify-center gap-3 border border-border px-5 text-xs font-semibold tracking-[0.12em] uppercase transition-colors duration-300 hover:border-foreground hover:bg-foreground hover:text-background"
              href="/work"
            >
              View the work
            </Link>
          </div>
        </FadeReveal>

        {hero?.cover ? (
          <FadeReveal
            className="self-center lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:pl-4"
            delay={0.08}
          >
            <Link className="work-card group block" href={`/work/${hero.slug}`}>
              <MediaImage
                className="work-card-visual aspect-[4/5] w-full"
                image={hero.cover}
                priority
                ratioClassName="aspect-[4/5]"
                sizes="(min-width: 1024px) 38vw, 100vw"
              />
              <p className="mt-4 flex items-baseline justify-between gap-4 border-t border-border pt-4 text-[0.625rem] tracking-[0.15em] text-muted-foreground uppercase">
                <span className="text-foreground transition-colors group-hover:text-accent">
                  {hero.title}
                </span>
                <span>{hero.category.name}</span>
              </p>
            </Link>
          </FadeReveal>
        ) : null}

        <p className="self-end lg:col-span-4 lg:row-start-2">
          <a
            className="hidden min-h-12 items-center gap-3 text-[0.625rem] tracking-[0.16em] text-muted-foreground uppercase transition-colors hover:text-foreground lg:inline-flex"
            href="#selected-work"
          >
            <ArrowDown aria-hidden="true" size={15} strokeWidth={1.5} />
            Scroll to selected work
          </a>
        </p>
      </Container>
    </section>
  );
}
