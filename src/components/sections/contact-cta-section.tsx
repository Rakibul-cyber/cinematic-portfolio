import Link from "next/link";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { Container } from "@/components/ui/container";
import { sectionLabels } from "@/content/site";
import type { PublicSiteSettings } from "@/server/public/view-models";

type ContactCtaSectionProps = {
  settings: PublicSiteSettings | null;
};

/**
 * Closing invitation.
 *
 * Points at the contact page rather than collecting anything: the inquiry form
 * and its persistence belong to a later phase, so nothing here implies a
 * message can be sent yet.
 */
export function ContactCtaSection({ settings }: ContactCtaSectionProps) {
  return (
    <section
      aria-labelledby="contact-title"
      className="scroll-mt-20 py-24 sm:py-32 lg:py-44"
      id="contact"
    >
      <Container>
        <FadeReveal className="text-center">
          <p className="mb-6 text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
            {sectionLabels.contact}
          </p>
          <h2
            className="editorial-balance mx-auto max-w-5xl font-display text-[clamp(3.25rem,9vw,10rem)] leading-[0.82] font-medium tracking-[-0.045em]"
            id="contact-title"
          >
            Have a story in mind?
          </h2>
          {settings?.contactEmail ? (
            <p className="mx-auto mt-8 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
              Write to{" "}
              <a
                className="text-foreground underline underline-offset-4 transition-colors hover:text-accent"
                href={`mailto:${settings.contactEmail}`}
              >
                {settings.contactEmail}
              </a>
              , or see the studio contact details.
            </p>
          ) : null}
          <Link
            className="mt-9 inline-flex min-h-12 items-center justify-center border border-accent bg-accent px-5 text-xs font-semibold tracking-[0.12em] text-accent-foreground uppercase transition-colors duration-300 hover:border-foreground hover:bg-foreground"
            href="/contact"
          >
            Get in touch
          </Link>
        </FadeReveal>
      </Container>
    </section>
  );
}
