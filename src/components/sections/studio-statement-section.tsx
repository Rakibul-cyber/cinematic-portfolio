import { FadeReveal } from "@/components/motion/fade-reveal";
import { Container } from "@/components/ui/container";
import { siteContent } from "@/content/site";

export function StudioStatementSection() {
  const { studio } = siteContent;

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
              {studio.eyebrow}
            </p>
            <div className="lg:col-span-8 lg:col-start-5">
              <h2
                className="editorial-balance font-display text-[clamp(3rem,7vw,7.25rem)] leading-[0.9] font-medium tracking-[-0.04em]"
                id="studio-title"
              >
                {studio.statement}
              </h2>
              <p className="mt-8 max-w-xl text-sm leading-7 text-muted-foreground">
                {studio.note}
              </p>
            </div>
          </div>
        </FadeReveal>
      </Container>
    </section>
  );
}
