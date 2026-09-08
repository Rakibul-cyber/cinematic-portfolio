import Link from "next/link";

import { SocialLinks } from "@/components/public/social-links";
import { Container } from "@/components/ui/container";
import { FALLBACK_STUDIO_NAME, navigation } from "@/content/site";
import { getActiveSocialLinks, getPublicSiteSettings } from "@/server/public/queries";

/**
 * Public footer.
 *
 * Every fact shown here comes from site settings or active social links; no
 * company, legal, or contact detail is invented. Sections with no data are
 * omitted rather than filled. Legal pages belong to the later GDPR phase and
 * are deliberately not linked yet.
 */
export async function SiteFooter() {
  const [settings, socialLinks] = await Promise.all([
    getPublicSiteSettings(),
    getActiveSocialLinks(),
  ]);

  const studioName = settings?.studioName ?? FALLBACK_STUDIO_NAME;

  return (
    <footer className="border-t border-border py-10 sm:py-12">
      <Container>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr] lg:items-end">
          <div>
            <Link
              aria-label={`${studioName}, home`}
              className="inline-block py-2 text-xs font-semibold tracking-[0.18em] uppercase"
              href="/"
            >
              {studioName}
            </Link>
            {settings?.contactEmail ? (
              <p className="mt-2">
                <a
                  className="text-xs text-muted-foreground transition-colors hover:text-accent"
                  href={`mailto:${settings.contactEmail}`}
                >
                  {settings.contactEmail}
                </a>
              </p>
            ) : null}
            {settings?.locationText ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {settings.locationText}
              </p>
            ) : null}
            <SocialLinks
              className="mt-3"
              label={`${studioName} on social media`}
              links={socialLinks}
            />
          </div>

          <nav aria-label="Footer navigation" className="lg:order-none">
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {navigation.map((item) => (
                <li key={item.href}>
                  <Link
                    className="inline-flex min-h-11 items-center text-[0.625rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase transition-colors hover:text-foreground"
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <p className="text-xs text-muted-foreground sm:text-right">
            {settings?.footerCopyright ??
              `© ${new Date().getFullYear()} ${studioName}`}
          </p>
        </div>
      </Container>
    </footer>
  );
}
