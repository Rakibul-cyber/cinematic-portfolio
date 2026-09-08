import Link from "next/link";

import { MobileNavigation } from "@/components/layout/mobile-navigation";
import { PrimaryNav } from "@/components/layout/primary-nav";
import { Container } from "@/components/ui/container";
import { FALLBACK_STUDIO_NAME } from "@/content/site";
import { getPublicSiteSettings } from "@/server/public/queries";

/**
 * Public header.
 *
 * A Server Component so the studio identity comes from site settings without
 * shipping a data fetch to the browser. Only the two genuinely interactive
 * parts — the current-section marker and the mobile menu — are client code.
 */
export async function SiteHeader() {
  const settings = await getPublicSiteSettings();
  const studioName = settings?.studioName ?? FALLBACK_STUDIO_NAME;

  return (
    <header className="sticky top-0 z-50 h-[var(--header-height)] border-b border-border bg-background">
      <Container className="flex h-full items-center justify-between">
        <Link
          aria-label={`${studioName}, home`}
          className="flex min-h-12 flex-col justify-center"
          href="/"
        >
          <span className="text-xs font-semibold tracking-[0.18em] uppercase">
            {studioName}
          </span>
          {settings?.tagline ? (
            <span className="mt-1 text-[0.5625rem] tracking-[0.15em] text-muted-foreground uppercase">
              {settings.tagline}
            </span>
          ) : null}
        </Link>

        <PrimaryNav />

        <MobileNavigation tagline={settings?.tagline ?? null} />
      </Container>
    </header>
  );
}
