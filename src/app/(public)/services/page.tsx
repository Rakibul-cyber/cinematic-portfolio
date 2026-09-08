import type { Metadata } from "next";
import Link from "next/link";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { PageIntro } from "@/components/public/page-intro";
import { TestimonialsSection } from "@/components/sections/testimonials-section";
import { Container } from "@/components/ui/container";
import { buildPublicMetadata } from "@/server/public/metadata";
import {
  getActiveServices,
  getActiveTestimonials,
  getPublicPage,
} from "@/server/public/queries";

// Next.js requires a literal here. Keep it equal to PUBLIC_REVALIDATE_SECONDS
// in src/server/public/cache-tags.ts, which is the documented safety net;
// admin saves invalidate by tag long before this elapses.
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublicPage("services");

  return buildPublicMetadata({
    title: page?.seoTitle ?? page?.title ?? "Services",
    description: page?.seoDescription ?? page?.body.at(0),
    path: "/services",
  });
}

/**
 * Public services page.
 *
 * Active services only, in their configured order, with the studio's own
 * `priceLabel` shown verbatim when one exists — no price, package, or duration
 * is derived or invented, and there is no checkout, booking, or quote flow.
 */
export default async function ServicesPage() {
  const [page, services, testimonials] = await Promise.all([
    getPublicPage("services"),
    getActiveServices(),
    getActiveTestimonials({ take: 2 }),
  ]);

  return (
    <main id="main-content">
      <PageIntro
        eyebrow={page?.eyebrow ?? "Practice"}
        lead={page?.body.at(0)}
        title={page?.title ?? "Services"}
      />

      {services.length ? (
        <Container>
          <ul className="border-t border-border">
            {services.map((service, index) => (
              <li key={service.slug}>
                <FadeReveal delay={Math.min(index, 4) * 0.04}>
                  <article className="grid gap-4 border-b border-border py-10 lg:grid-cols-12 lg:gap-x-8 lg:py-14">
                    <div className="lg:col-span-5">
                      <h2 className="font-display text-4xl font-medium tracking-[-0.02em] sm:text-5xl">
                        {service.name}
                      </h2>
                      {service.priceLabel ? (
                        <p className="mt-4 text-[0.6875rem] font-semibold tracking-[0.14em] text-accent uppercase">
                          {service.priceLabel}
                        </p>
                      ) : null}
                    </div>
                    <div className="lg:col-span-6 lg:col-start-7">
                      <p className="text-sm leading-7 sm:text-base">
                        {service.shortDescription}
                      </p>
                      {service.description.map((paragraph) => (
                        <p
                          className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground"
                          key={paragraph.slice(0, 48)}
                        >
                          {paragraph}
                        </p>
                      ))}
                    </div>
                  </article>
                </FadeReveal>
              </li>
            ))}
          </ul>

          <FadeReveal className="py-16 sm:py-24">
            <Link
              className="inline-flex min-h-12 items-center justify-center border border-accent bg-accent px-5 text-xs font-semibold tracking-[0.12em] text-accent-foreground uppercase transition-colors duration-300 hover:border-foreground hover:bg-foreground"
              href="/contact"
            >
              Discuss a project
            </Link>
          </FadeReveal>
        </Container>
      ) : (
        <Container>
          <div className="border-t border-border py-16 sm:py-24">
            {page?.body.slice(1).map((paragraph) => (
              <p
                className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground first:mt-0 sm:text-base"
                key={paragraph.slice(0, 48)}
              >
                {paragraph}
              </p>
            ))}
            <Link
              className="mt-10 inline-flex min-h-12 items-center justify-center border border-border px-5 text-xs font-semibold tracking-[0.12em] uppercase transition-colors duration-300 hover:border-foreground hover:bg-foreground hover:text-background"
              href="/contact"
            >
              Get in touch
            </Link>
          </div>
        </Container>
      )}

      <TestimonialsSection
        className="border-t border-border py-20 sm:py-28"
        testimonials={testimonials}
      />
    </main>
  );
}
