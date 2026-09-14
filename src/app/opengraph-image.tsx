import { ImageResponse } from "next/og";

import { FALLBACK_STUDIO_NAME } from "@/content/site";
import { SITE_THEME_COLOR } from "@/lib/constants";
import { getPublicSiteSettings } from "@/server/public/queries";

// Next.js requires a literal here. Keep it equal to PUBLIC_REVALIDATE_SECONDS
// in src/server/public/cache-tags.ts.
export const revalidate = 3600;

export const alt = "Studio share image";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The share image used when a page has none of its own.
 *
 * Project pages share their cover photograph; `/`, `/work`, `/services`,
 * `/about`, and `/contact` have no single representative frame, so a social
 * card would otherwise fall back to whatever the platform scrapes. This renders
 * a typographic card instead — the studio name and tagline from the CMS on the
 * site's own background, and nothing else.
 *
 * Deliberately text-only: compositing a photograph here would pick one project
 * to represent the whole studio, and would tie a build artifact to a media
 * object that an editor can delete.
 */
export default async function OpengraphImage() {
  const settings = await getPublicSiteSettings();
  const studioName = settings?.studioName ?? FALLBACK_STUDIO_NAME;

  return new ImageResponse(
    (
      <div
        style={{
          background: SITE_THEME_COLOR,
          color: "#f4f1ea",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "flex-end",
          padding: "80px",
          width: "100%",
        }}
      >
        <div
          style={{
            fontSize: 88,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
          }}
        >
          {studioName}
        </div>
        {settings?.tagline ? (
          <div
            style={{
              fontSize: 32,
              marginTop: 24,
              opacity: 0.65,
            }}
          >
            {settings.tagline}
          </div>
        ) : null}
      </div>
    ),
    size,
  );
}
