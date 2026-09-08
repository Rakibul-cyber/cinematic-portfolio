import type { Metadata } from "next";

import { FadeReveal } from "@/components/motion/fade-reveal";
import { PageIntro } from "@/components/public/page-intro";
import { SocialLinks } from "@/components/public/social-links";
import { InquiryForm } from "@/components/public/inquiry-form";
import { Container } from "@/components/ui/container";
import { FALLBACK_STUDIO_NAME } from "@/content/site";
import { buildPublicMetadata } from "@/server/public/metadata";
import {
  getActiveSocialLinks,
  getPublicPage,
  getPublicSiteSettings,
  getActiveServices,
} from "@/server/public/queries";

// Next.js requires a literal here. Keep it equal to PUBLIC_REVALIDATE_SECONDS
// in src/server/public/cache-tags.ts, which is the documented safety net;
// admin saves invalidate by tag long before this elapses.
export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const page = await getPublicPage("contact");

  return buildPublicMetadata({
    title: page?.seoTitle ?? page?.title ?? "Contact",
    description: page?.seoDescription ?? page?.body.at(0),
    path: "/contact",
  });
}

/**
 * Public contact page — presentation only.
 *
 * It shows the ways to reach the studio and nothing more. There is deliberately
 * no form: the inquiry model, validation, persistence, and email notification
 * belong to later phases, and a form that could not actually deliver a message
 * would be worse than none. Every detail comes from site settings, so no email
 * address, phone number, or location is invented.
 */
export default async function ContactPage() {
  const [page, settings, socialLinks, services] = await Promise.all([
    getPublicPage("contact"),
    getPublicSiteSettings(),
    getActiveSocialLinks(),
    getActiveServices(),
  ]);

  const studioName = settings?.studioName ?? FALLBACK_STUDIO_NAME;

  const channels = [
    settings?.contactEmail && {
      label: "Email",
      value: settings.contactEmail,
      href: `mailto:${settings.contactEmail}`,
      external: false,
    },
    settings?.contactPhone &&
      settings.phoneHref && {
        label: "Phone",
        value: settings.contactPhone,
        href: settings.phoneHref,
        external: false,
      },
    settings?.whatsappNumber &&
      settings.whatsappHref && {
        label: "WhatsApp",
        value: settings.whatsappNumber,
        href: settings.whatsappHref,
        external: true,
      },
  ].filter(Boolean) as {
    label: string;
    value: string;
    href: string;
    external: boolean;
  }[];

  return (
    <main id="main-content">
      <PageIntro
        eyebrow={page?.eyebrow ?? "Start a conversation"}
        lead={page?.body.at(0)}
        title={page?.title ?? "Contact"}
      />

      <Container>
        <div className="grid gap-12 border-t border-border py-16 sm:py-24 lg:grid-cols-12 lg:gap-x-8">
          <FadeReveal className="lg:col-span-6">
            {page?.body.slice(1).map((paragraph) => (
              <p
                className="mt-5 max-w-2xl text-sm leading-7 text-muted-foreground first:mt-0 sm:text-base sm:leading-8"
                key={paragraph.slice(0, 48)}
              >
                {paragraph}
              </p>
            ))}
          </FadeReveal>

          <FadeReveal className="lg:col-span-5 lg:col-start-8">
            {channels.length ? (
              <dl className="grid gap-6">
                {channels.map((channel) => (
                  <div key={channel.label}>
                    <dt className="text-[0.625rem] tracking-[0.15em] text-muted-foreground uppercase">
                      {channel.label}
                    </dt>
                    <dd className="mt-1">
                      <a
                        className="font-display text-2xl transition-colors hover:text-accent sm:text-3xl"
                        href={channel.href}
                        {...(channel.external
                          ? { rel: "noopener noreferrer", target: "_blank" }
                          : {})}
                      >
                        {channel.value}
                      </a>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {settings?.locationText ? (
              <p className="mt-10 text-sm leading-7 text-muted-foreground">
                {settings.locationText}
              </p>
            ) : null}

            <SocialLinks
              className="mt-8"
              label={`${studioName} on social media`}
              links={socialLinks}
            />
          </FadeReveal>
        </div>
      </Container>
      <Container className="pb-24 sm:pb-32">
        <div className="grid gap-10 border-t border-border pt-16 lg:grid-cols-12">
          <div className="lg:col-span-4"><p className="text-xs tracking-[0.16em] text-accent uppercase">Project inquiry</p><h2 className="mt-4 font-display text-4xl">Tell us what you are planning.</h2></div>
          <div className="lg:col-span-7 lg:col-start-6"><InquiryForm services={services}/></div>
        </div>
      </Container>
    </main>
  );
}
