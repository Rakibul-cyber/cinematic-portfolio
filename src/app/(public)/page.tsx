import { ContactCtaSection } from "@/components/sections/contact-cta-section";
import { FeaturedWorkSection } from "@/components/sections/featured-work-section";
import { HeroSection } from "@/components/sections/hero-section";
import { ServicesPreviewSection } from "@/components/sections/services-preview-section";
import { ShowreelSection } from "@/components/sections/showreel-section";
import { StudioStatementSection } from "@/components/sections/studio-statement-section";

export default function HomePage() {
  return (
    <main id="main-content">
      <HeroSection />
      <FeaturedWorkSection />
      <ShowreelSection />
      <ServicesPreviewSection />
      <StudioStatementSection />
      <ContactCtaSection />
    </main>
  );
}
