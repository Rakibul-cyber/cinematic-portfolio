import type { Metadata } from "next";

import { ContactCtaSection } from "@/components/sections/contact-cta-section";
import { FeaturedWorkSection } from "@/components/sections/featured-work-section";
import { HeroSection } from "@/components/sections/hero-section";
import { ServicesPreviewSection } from "@/components/sections/services-preview-section";
import { ShowreelSection } from "@/components/sections/showreel-section";
import { StudioStatementSection } from "@/components/sections/studio-statement-section";
import { TestimonialsSection } from "@/components/sections/testimonials-section";
import { FALLBACK_STUDIO_NAME } from "@/content/site";
import { buildPublicMetadata } from "@/server/public/metadata";
import { getHomepageContent } from "@/server/public/queries";

// Next.js requires a literal here. Keep it equal to PUBLIC_REVALIDATE_SECONDS
// in src/server/public/cache-tags.ts, which is the documented safety net;
// admin saves invalidate by tag long before this elapses.
export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return buildPublicMetadata({ path: "/" });
}

/**
 * Homepage.
 *
 * Every section is CMS-backed and every optional section removes itself when
 * its content is absent, so an empty CMS yields a composed hero and contact
 * invitation rather than placeholder work, services, or testimonials.
 *
 * One cached composition supplies the whole page, so the six entities it shows
 * do not each become a separate uncached round trip.
 */
export default async function HomePage() {
  const { about, featured, hero, services, settings, testimonials } =
    await getHomepageContent();

  return (
    <main id="main-content">
      <HeroSection hero={hero} settings={settings} />
      <FeaturedWorkSection projects={featured} />
      <ShowreelSection
        showreel={settings?.showreel ?? null}
        studioName={settings?.studioName ?? FALLBACK_STUDIO_NAME}
      />
      <ServicesPreviewSection services={services} />
      <StudioStatementSection about={about} />
      <TestimonialsSection
        className="border-b border-border py-24 sm:py-32"
        testimonials={testimonials}
      />
      <ContactCtaSection settings={settings} />
    </main>
  );
}
