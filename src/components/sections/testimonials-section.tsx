import { FadeReveal } from "@/components/motion/fade-reveal";
import { TestimonialList } from "@/components/public/testimonial-list";
import { Container } from "@/components/ui/container";
import { sectionLabels } from "@/content/site";
import type { PublicTestimonial } from "@/server/public/view-models";

type TestimonialsSectionProps = {
  testimonials: readonly PublicTestimonial[];
  className?: string;
};

/** Active testimonials in configured order, or nothing at all. */
export function TestimonialsSection({
  className,
  testimonials,
}: TestimonialsSectionProps) {
  if (testimonials.length === 0) return null;

  return (
    <section
      aria-labelledby="testimonials-title"
      className={className ?? "py-24 sm:py-32 lg:py-40"}
    >
      <Container>
        <FadeReveal>
          <h2
            className="text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase"
            id="testimonials-title"
          >
            {sectionLabels.testimonials}
          </h2>
        </FadeReveal>
        <TestimonialList className="mt-12" testimonials={testimonials} />
      </Container>
    </section>
  );
}
