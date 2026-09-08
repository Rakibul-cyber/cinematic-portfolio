import Link from "next/link";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { sectionLabels } from "@/content/site";
import type { PublicService } from "@/server/public/view-models";

type ServicesPreviewSectionProps = {
  services: readonly PublicService[];
};

/**
 * Services preview on the homepage.
 *
 * Active services only, in their configured order. No service, description, or
 * price is invented, so an empty services list removes the section.
 */
export function ServicesPreviewSection({
  services,
}: ServicesPreviewSectionProps) {
  if (services.length === 0) return null;

  return (
    <section
      aria-labelledby="services-title"
      className="scroll-mt-20 py-24 sm:py-32 lg:py-40"
      id="services"
    >
      <Container>
        <FadeReveal>
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <SectionHeading
              className="lg:col-span-8"
              eyebrow={sectionLabels.services}
              title="What the studio offers"
              titleId="services-title"
            />
            <Link
              className="inline-flex min-h-12 items-center text-[0.6875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase transition-colors hover:text-foreground lg:col-span-4 lg:justify-self-end"
              href="/services"
            >
              All services
            </Link>
          </div>
        </FadeReveal>

        <ul className="mt-16 border-t border-border lg:mt-24">
          {services.map((service, index) => (
            <li key={service.slug}>
              <FadeReveal delay={Math.min(index, 4) * 0.04}>
                <article className="grid gap-3 border-b border-border py-7 sm:grid-cols-[4rem_1fr] sm:gap-6 lg:grid-cols-12 lg:items-baseline lg:py-9">
                  <span
                    aria-hidden="true"
                    className="text-[0.625rem] tracking-[0.14em] text-accent lg:col-span-1"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-display text-4xl font-medium tracking-[-0.02em] sm:text-5xl lg:col-span-5">
                    {service.name}
                  </h3>
                  <p className="max-w-lg text-sm leading-7 text-muted-foreground sm:col-start-2 lg:col-span-5 lg:col-start-8">
                    {service.shortDescription}
                  </p>
                </article>
              </FadeReveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
