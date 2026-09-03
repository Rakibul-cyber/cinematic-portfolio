import { FadeReveal } from "@/components/motion/fade-reveal";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { siteContent } from "@/content/site";

export function ServicesPreviewSection() {
  const { services } = siteContent;

  return (
    <section
      aria-labelledby="services-title"
      className="scroll-mt-20 py-24 sm:py-32 lg:py-40"
      id="services"
    >
      <Container>
        <FadeReveal>
          <div className="grid gap-10 lg:grid-cols-12">
            <SectionHeading
              className="lg:col-span-8"
              description={services.description}
              eyebrow={services.eyebrow}
              title={services.title}
              titleId="services-title"
            />
          </div>
        </FadeReveal>

        <div className="mt-16 border-t border-border lg:mt-24">
          {services.items.map((service, index) => (
            <FadeReveal delay={index * 0.04} key={service.number}>
              <article className="grid gap-3 border-b border-border py-7 sm:grid-cols-[4rem_1fr] sm:gap-6 lg:grid-cols-12 lg:items-baseline lg:py-9">
                <span className="text-[0.625rem] tracking-[0.14em] text-accent lg:col-span-1">
                  {service.number}
                </span>
                <h3 className="font-display text-4xl font-medium tracking-[-0.02em] sm:text-5xl lg:col-span-5">
                  {service.title}
                </h3>
                <p className="max-w-lg text-sm leading-7 text-muted-foreground sm:col-start-2 lg:col-span-5 lg:col-start-8">
                  {service.description}
                </p>
              </article>
            </FadeReveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
