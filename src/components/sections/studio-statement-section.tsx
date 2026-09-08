import Link from "next/link";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { Container } from "@/components/ui/container";
import { sectionLabels } from "@/content/site";
import type { PublicPageContent } from "@/server/public/view-models";

type StudioStatementSectionProps = {
  about: PublicPageContent | null;
};

/**
 * Studio statement on the homepage.
 *
 * Shows the opening of the CMS About page — its title as the statement and its
 * first paragraph as supporting copy — and links to the full page. No
 * biography, history, or credential is written here; without About content the
 * section is omitted.
 */
export function StudioStatementSection({ about }: StudioStatementSectionProps) {
  if (!about) return null;

  const [opening] = about.body;

  return (
    <section
      aria-labelledby="studio-title"
      className="scroll-mt-20 border-y border-border py-24 sm:py-32 lg:py-40"
      id="about"
    >
      <Container>
        <FadeReveal>
          <div className="grid gap-10 lg:grid-cols-12">
            <p className="text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase lg:col-span-3">
              {about.eyebrow ?? sectionLabels.studio}
            </p>
            <div className="lg:col-span-8 lg:col-start-5">
              <h2
                className="editorial-balance font-display text-[clamp(2.5rem,6vw,7.25rem)] leading-[0.9] font-medium tracking-[-0.04em]"
                id="studio-title"
              >
                {about.title}
              </h2>
              {opening ? (
                <p className="mt-8 max-w-xl text-sm leading-7 text-muted-foreground">
                  {opening}
                </p>
              ) : null}
              <Link
                className="mt-8 inline-flex min-h-12 items-center text-[0.6875rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase transition-colors hover:text-foreground"
                href="/about"
              >
                About the studio
              </Link>
            </div>
          </div>
        </FadeReveal>
      </Container>
    </section>
  );
}
