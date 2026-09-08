import { FadeReveal } from "@/components/motion/fade-reveal";
import { cn } from "@/lib/utils";
import type { PublicTestimonial } from "@/server/public/view-models";

type TestimonialListProps = {
  testimonials: readonly PublicTestimonial[];
  className?: string;
};

/**
 * Ordered testimonials. Renders nothing at all when none are active, so a
 * quiet CMS produces a shorter page rather than an empty heading.
 */
export function TestimonialList({
  className,
  testimonials,
}: TestimonialListProps) {
  if (testimonials.length === 0) return null;

  return (
    <ul className={cn("grid gap-12 md:grid-cols-2 md:gap-x-16", className)}>
      {testimonials.map((testimonial, index) => (
        <li key={`${testimonial.authorName}-${index}`}>
          <FadeReveal delay={index * 0.05}>
            <figure>
              <blockquote className="font-display text-2xl leading-[1.35] font-medium tracking-[-0.01em] text-balance sm:text-3xl">
                {testimonial.quote}
              </blockquote>
              <figcaption className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
                <span className="text-foreground">{testimonial.authorName}</span>
                {testimonial.attribution ? (
                  <span className="block pt-1">{testimonial.attribution}</span>
                ) : null}
              </figcaption>
            </figure>
          </FadeReveal>
        </li>
      ))}
    </ul>
  );
}
