import type { MetadataRoute } from "next";

import { buildRobots } from "@/lib/seo/robots-rules";
import { siteOrigin } from "@/server/public/metadata";

/**
 * `/robots.txt`.
 *
 * The crawl policy itself lives in `buildRobots`, which is pure and verified
 * offline. Static: it depends on the deployment origin only, never on content.
 */
export default function robots(): MetadataRoute.Robots {
  return buildRobots(siteOrigin());
}
