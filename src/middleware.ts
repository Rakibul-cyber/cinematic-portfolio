import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

import { ADMIN_LOGIN_PATH } from "@/lib/admin-routes";

/**
 * Routing convenience only — not an authorization control.
 *
 * This runs on the Edge runtime and therefore cannot reach the database. It
 * only checks whether a session cookie is *present* so that an unauthenticated
 * visitor is redirected to the login page instead of briefly rendering a
 * protected route. The cookie is not verified here.
 *
 * Real enforcement happens in the page/action itself through
 * `requireUser` / `requireRole`, which validate the session against PostgreSQL.
 * Never add a privileged decision to this file.
 *
 * The Edge runtime is used deliberately because every hosting target supports
 * it. Bundling `better-auth/cookies` for Edge emits a build warning about
 * `DecompressionStream` from a transitive `jose` import; that code path belongs
 * to JWE decryption, which this file never reaches. Switching to
 * `runtime: "nodejs"` silences it, but only once Netlify support for Node.js
 * middleware is verified in Phase 10.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (pathname === ADMIN_LOGIN_PATH) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const hasSessionCookie = Boolean(getSessionCookie(request));

  if (hasSessionCookie) {
    const response = NextResponse.next();
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  const loginUrl = new URL(ADMIN_LOGIN_PATH, request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);

  const response = NextResponse.redirect(loginUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  // Admin pages only. The Better Auth endpoints under /api/auth must stay
  // reachable so signing in is possible.
  //
  // Next.js requires these patterns to be statically analyzable literals, so
  // they cannot be built from the shared route constants.
  matcher: ["/admin", "/admin/:path*"],
};
