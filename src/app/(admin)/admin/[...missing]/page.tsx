import { notFound } from "next/navigation";

import { requireUser } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * Unknown admin addresses.
 *
 * Next.js sends an unmatched URL to the root 404, not to a segment's
 * `not-found.tsx`, so this lowest-priority catch-all brings them into the admin
 * area. The session is checked first: someone who is not signed in is sent to
 * the login page, exactly as for a real admin page, so the admin 404 cannot be
 * used to probe which admin routes exist. (Middleware already redirects
 * requests without a session cookie; this also covers a stale or forged one.)
 */
export default async function MissingAdminPage({ params }: { params: Promise<{ missing: string[] }> }) {
  const { missing } = await params;
  await requireUser(`/admin/${missing.map(encodeURIComponent).join("/")}`);
  notFound();
}
