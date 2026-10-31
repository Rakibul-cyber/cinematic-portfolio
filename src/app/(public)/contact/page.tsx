import type { Metadata } from "next";

import "./contact.css";

import { BrandStatement, ContactHero, DirectContact, InquiryIntro } from "@/components/contact/contact-sections";
import { SocialLinks } from "@/components/public/social-links";
import { InquiryForm } from "@/components/public/inquiry-form";
import { JsonLd } from "@/components/seo/json-ld";
import { isInquiryIntakeOpen } from "@/content/legal";
import { emptyStates, resolveContactDetails } from "@/content/site";
import { buildPublicMetadata } from "@/server/public/metadata";
import {
  getActiveSocialLinks,
  getPublicPage,
  getPublicSiteSettings,
  getActiveServices,
} from "@/server/public/queries";
import { breadcrumbStructuredData } from "@/server/seo/structured-data";

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
 * Public contact page, in the black-and-gold design scoped by `contact.css`.
 *
 * CMS page copy replaces the design's default wording once it is saved. The
 * form submits to the `submitInquiry` server action in `./actions.ts`, which
 * validates, applies abuse controls, stores the inquiry and sends notification
 * email. The form and its Turnstile widget render only while
 * `isInquiryIntakeOpen()` holds; the action enforces the same gate itself.
 */
export default async function ContactPage() {
  const [page, settings, socialLinks, services, structuredData] =
    await Promise.all([
      getPublicPage("contact"),
      getPublicSiteSettings(),
      getActiveSocialLinks(),
      getActiveServices(),
      breadcrumbStructuredData([
        { name: "Home", path: "/" },
        { name: "Contact", path: "/contact" },
      ]),
    ]);

  const details = resolveContactDetails(settings);

  return (
    <main className="mv-contact" id="main-content">
      <ContactHero
        eyebrow={page?.eyebrow ?? "Start a conversation"}
        lead={page?.body.at(0) ?? "Photography, filmmaking, events, commercial shoots and creative collaborations — every project begins with a conversation. Tell us what you are imagining, and we will shape it into a story told with intention."}
        title={page?.title}
      />

      <section aria-label="Project inquiry" className="mv-inquiry" id="inquiry">
        <div className="mv-wrap mv-inquiry-grid">
          <InquiryIntro>
            {page?.body.slice(1).map((paragraph) => (
              <p className="mv-intro-text" key={paragraph.slice(0, 48)}>
                {paragraph}
              </p>
            ))}
            <a className="mv-action mt-6" href="#direct-contact">Contact details</a>
          </InquiryIntro>
          <div className="mv-inquiry-main">
            {isInquiryIntakeOpen() ? (
              <InquiryForm services={services} turnstileSiteKey={process.env.TURNSTILE_SITE_KEY?.trim() ?? null}/>
            ) : (
              <p className="mv-closed">{emptyStates.inquiry}</p>
            )}
          </div>
        </div>
      </section>

      <DirectContact details={details}>
        <SocialLinks
          className="mv-direct-social"
          label={`${details.business} on social media`}
          links={socialLinks}
        />
      </DirectContact>

      <BrandStatement />

      <JsonLd nodes={structuredData} />
    </main>
  );
}
