import { ArrowDown } from "lucide-react";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { VisualPlaceholder } from "@/components/ui/visual-placeholder";
import { siteContent } from "@/content/site";

export function HeroSection() {
  const { hero } = siteContent;

  return (
    <section aria-labelledby="hero-title" className="relative scroll-mt-20 pb-20" id="top">
      <Container className="grid min-h-[calc(100svh-var(--header-height))] grid-rows-[auto_1fr_auto] gap-10 py-10 sm:py-14 lg:grid-cols-12 lg:grid-rows-[1fr_auto] lg:gap-x-8 lg:py-16">
        <FadeReveal className="relative z-10 self-center lg:col-span-7 lg:row-start-1">
          <p className="mb-5 text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
            {hero.eyebrow}
          </p>
          <h1
            className="editorial-balance max-w-5xl font-display text-[clamp(4rem,11vw,10.5rem)] leading-[0.78] font-medium tracking-[-0.045em]"
            id="hero-title"
          >
            {hero.title}
          </h1>
          <div className="mt-8 flex max-w-2xl flex-col items-start gap-7 sm:flex-row sm:items-end sm:justify-between lg:mt-10">
            <p className="max-w-md text-sm leading-7 text-muted-foreground sm:text-base">
              {hero.description}
            </p>
            <ButtonLink href={hero.primaryAction.href}>{hero.primaryAction.label}</ButtonLink>
          </div>
        </FadeReveal>

        <FadeReveal
          className="self-center lg:col-span-5 lg:col-start-8 lg:row-start-1 lg:pl-4"
          delay={0.08}
        >
          <VisualPlaceholder
            className="hero-visual aspect-[4/5] min-h-96 w-full"
            label={hero.visualLabel}
            tone="ink"
          />
          <div className="mt-4 flex flex-wrap justify-between gap-3 border-t border-border pt-4">
            {hero.context.map((label, index) => (
              <span
                className="text-[0.625rem] tracking-[0.15em] text-muted-foreground uppercase"
                key={label}
              >
                0{index + 1} / {label}
              </span>
            ))}
          </div>
        </FadeReveal>

        <a
          className="hidden min-h-12 items-center gap-3 self-end text-[0.625rem] tracking-[0.16em] text-muted-foreground uppercase transition-colors hover:text-foreground lg:col-span-4 lg:row-start-2 lg:flex"
          href="#work"
        >
          <ArrowDown aria-hidden="true" size={15} strokeWidth={1.5} />
          {hero.scrollLabel}
        </a>

        <p className="self-end text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase lg:col-span-8 lg:row-start-2 lg:text-right">
          {siteContent.contentNotice}
        </p>
      </Container>
    </section>
  );
}
