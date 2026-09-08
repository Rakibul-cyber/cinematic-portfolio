import { FadeReveal } from "@/components/motion/fade-reveal";
import { Container } from "@/components/ui/container";

type PageIntroProps = {
  eyebrow?: string | null;
  title: string;
  lead?: string | null;
};

/**
 * Opening block of a public page: the one `h1` on the page, with generous
 * space above the content that follows.
 */
export function PageIntro({ eyebrow, lead, title }: PageIntroProps) {
  return (
    <Container>
      <FadeReveal className="pt-16 pb-12 sm:pt-24 sm:pb-16 lg:pt-32 lg:pb-24">
        {eyebrow ? (
          <p className="mb-5 text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="editorial-balance max-w-4xl font-display text-[clamp(3rem,8vw,8rem)] leading-[0.86] font-medium tracking-[-0.04em]">
          {title}
        </h1>
        {lead ? (
          <p className="mt-8 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">
            {lead}
          </p>
        ) : null}
      </FadeReveal>
    </Container>
  );
}
