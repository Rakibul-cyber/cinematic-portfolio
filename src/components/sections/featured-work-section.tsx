import { FadeReveal } from "@/components/motion/fade-reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { VisualPlaceholder } from "@/components/ui/visual-placeholder";
import { siteContent } from "@/content/site";
import { cn } from "@/lib/utils";

export function FeaturedWorkSection() {
  const { featuredWork } = siteContent;

  return (
    <section
      aria-labelledby="featured-work-title"
      className="scroll-mt-20 border-t border-border py-24 sm:py-32 lg:py-40"
      id="work"
    >
      <Container>
        <FadeReveal>
          <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
            <SectionHeading
              className="lg:col-span-8"
              eyebrow={featuredWork.eyebrow}
              title={featuredWork.title}
              titleId="featured-work-title"
            />
            <p className="max-w-md text-sm leading-7 text-muted-foreground lg:col-span-4 lg:justify-self-end">
              {featuredWork.description}
            </p>
          </div>
        </FadeReveal>

        <div className="mt-16 grid gap-x-6 gap-y-14 md:grid-cols-2 lg:mt-24 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-24">
          {featuredWork.items.map((item, index) => (
            <FadeReveal
              className={cn(
                "work-card group",
                item.layout === "wide"
                  ? "md:col-span-2 lg:col-span-7"
                  : "lg:col-span-5",
                index === 2 && "lg:col-start-7",
              )}
              delay={index * 0.05}
              key={item.title}
            >
              <article>
                <VisualPlaceholder
                  className={cn(
                    "work-card-visual w-full",
                    item.layout === "wide" ? "aspect-[16/10]" : "aspect-[4/5]",
                  )}
                  label={item.visualLabel}
                  tone={item.tone}
                />
                <div className="mt-5 flex items-start justify-between gap-6 border-t border-border pt-4">
                  <div>
                    <h3 className="font-display text-2xl font-medium sm:text-3xl">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">{item.discipline}</p>
                  </div>
                  <p className="pt-2 text-[0.5625rem] tracking-[0.14em] text-muted-foreground uppercase">
                    {item.note}
                  </p>
                </div>
              </article>
            </FadeReveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
