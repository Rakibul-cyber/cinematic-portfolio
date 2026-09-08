import type { Metadata } from "next";
import Link from "next/link";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { PageIntro } from "@/components/public/page-intro";
import { TestimonialsSection } from "@/components/sections/testimonials-section";
import { Container } from "@/components/ui/container";
import { FALLBACK_STUDIO_NAME } from "@/content/site";
import { buildPublicMetadata } from "@/server/public/metadata";
import {
  getActiveTestimonials,
  getPublicPage,
  getPublicSiteSettings,
} from "@/server/public/queries";

// Next.js requires a literal here. Keep it equal to PUBLIC_REVALIDATE_SECONDS
// in src/server/public/cache-tags.ts, which is the documented safety net;
// admin saves invalidate by tag long before this elapses.
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublicPage("about");

  return buildPublicMetadata({
    title: page?.seoTitle ?? page?.title ?? "About",
    description: page?.seoDescription ?? page?.body.at(0),
    path: "/about",
  });
}

/**
 * Public About page.
 *
 * The entire narrative is the CMS About page plus site settings. No biography,
 * award, client list, or years-of-experience figure is written here, so with no
 * About content saved the page falls back to the studio name and location only
 * — quiet, but honest and never a placeholder story.
 */
export default async function AboutPage() {
  const [page, settings, testimonials] = await Promise.all([
    getPublicPage("about"),
    getPublicSiteSettings(),
    getActiveTestimonials({ take: 4 }),
  ]);

  const studioName = settings?.studioName ?? FALLBACK_STUDIO_NAME;
  const [lead, ...rest] = page?.body ?? [];

  return (
    <main id="main-content">
      <PageIntro
        eyebrow={page?.eyebrow ?? "The studio"}
        lead={lead}
        title={page?.title ?? studioName}
      />

      <Container>
        <div className="grid gap-12 border-t border-border py-16 sm:py-24 lg:grid-cols-12 lg:gap-x-8">
          <FadeReveal className="lg:col-span-7">
            {rest.length ? (
              rest.map((paragraph) => (
                <p
                  className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground first:mt-0 sm:text-base sm:leading-8"
                  key={paragraph.slice(0, 48)}
                >
                  {paragraph}
                </p>
              ))
            ) : null}
          </FadeReveal>

          <FadeReveal className="lg:col-span-4 lg:col-start-9">
            <dl className="grid gap-5">
              <div>
                <dt className="text-[0.625rem] tracking-[0.15em] text-muted-foreground uppercase">
                  Studio
                </dt>
                <dd className="mt-1 text-sm">{studioName}</dd>
              </div>
              {settings?.locationText ? (
                <div>
                  <dt className="text-[0.625rem] tracking-[0.15em] text-muted-foreground uppercase">
                    Based in
                  </dt>
                  <dd className="mt-1 text-sm">{settings.locationText}</dd>
                </div>
              ) : null}
            </dl>
            <Link
              className="mt-10 inline-flex min-h-12 items-center text-[0.6875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase transition-colors hover:text-foreground"
              href="/contact"
            >
              Contact the studio
            </Link>
          </FadeReveal>
        </div>
      </Container>

      <TestimonialsSection
        className="border-t border-border py-20 sm:py-28"
        testimonials={testimonials}
      />
    </main>
  );
}
