import { Play } from "lucide-react";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { Container } from "@/components/ui/container";
import { siteContent } from "@/content/site";

export function ShowreelSection() {
  const { showreel } = siteContent;

  return (
    <section aria-labelledby="showreel-title" className="border-y border-border bg-surface py-24 sm:py-32">
      <Container>
        <FadeReveal>
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8">
              <p className="mb-5 text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
                {showreel.eyebrow}
              </p>
              <h2
                className="editorial-balance max-w-4xl font-display text-[clamp(3rem,7vw,7rem)] leading-[0.88] font-medium tracking-[-0.035em]"
                id="showreel-title"
              >
                {showreel.title}
              </h2>
            </div>
            <p className="max-w-md text-sm leading-7 text-muted-foreground lg:col-span-4 lg:justify-self-end">
              {showreel.description}
            </p>
          </div>

          <div
            aria-label={showreel.visualLabel}
            className="visual-placeholder mt-14 flex aspect-[4/3] items-center justify-center sm:mt-20 sm:aspect-video"
            data-tone="ink"
            role="img"
          >
            <div className="relative z-10 flex flex-col items-center gap-5 text-center">
              <span className="flex size-16 items-center justify-center border border-foreground/55 sm:size-20">
                <Play aria-hidden="true" className="ml-1 size-5 sm:size-6" fill="currentColor" strokeWidth={1} />
              </span>
              <span className="text-[0.625rem] tracking-[0.17em] text-foreground/70 uppercase">
                {showreel.unavailableLabel}
              </span>
            </div>
          </div>
        </FadeReveal>
      </Container>
    </section>
  );
}
