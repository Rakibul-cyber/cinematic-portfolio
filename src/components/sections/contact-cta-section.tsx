import { FadeReveal } from "@/components/motion/fade-reveal";
import { Container } from "@/components/ui/container";
import { siteContent } from "@/content/site";

export function ContactCtaSection() {
  const { contact } = siteContent;

  return (
    <section
      aria-labelledby="contact-title"
      className="scroll-mt-20 py-24 sm:py-32 lg:py-44"
      id="contact"
    >
      <Container>
        <FadeReveal className="text-center">
          <p className="mb-6 text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
            {contact.eyebrow}
          </p>
          <h2
            className="editorial-balance mx-auto max-w-5xl font-display text-[clamp(4rem,10vw,10rem)] leading-[0.82] font-medium tracking-[-0.045em]"
            id="contact-title"
          >
            {contact.title}
          </h2>
          <p className="mx-auto mt-8 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
            {contact.description}
          </p>
          <span className="mt-9 inline-flex min-h-12 items-center justify-center border border-accent bg-accent px-5 text-xs font-semibold tracking-[0.12em] text-accent-foreground uppercase">
            {contact.actionLabel}
          </span>
        </FadeReveal>
      </Container>
    </section>
  );
}
