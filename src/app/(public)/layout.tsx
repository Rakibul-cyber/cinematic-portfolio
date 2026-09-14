import { UmamiAnalytics } from "@/components/analytics/umami-analytics";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { JsonLd } from "@/components/seo/json-ld";
import { siteStructuredData } from "@/server/seo/structured-data";

/**
 * Public site shell.
 *
 * The cinematic header/footer chrome belongs to the public route group only.
 * The admin area under `/admin` deliberately renders its own, quieter shell.
 *
 * Two site-wide concerns are mounted here rather than in the root layout, so
 * neither reaches `/admin`: the Organization and WebSite structured data, which
 * describes the public site, and the optional analytics tracker, which must
 * never measure a private workspace.
 */
export default async function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nodes = await siteStructuredData();

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <SiteHeader />
      {children}
      <SiteFooter />
      <JsonLd nodes={nodes} />
      <UmamiAnalytics />
    </>
  );
}
