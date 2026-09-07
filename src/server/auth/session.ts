import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { buildLoginRedirect } from "@/lib/admin-routes";
import { AdminRole, roleAtLeast } from "@/server/auth/roles";
import { auth } from "@/server/auth/config";
import { prisma } from "@/server/db/prisma";

/**
 * Server-side session and authorization helpers.
 *
 * These are the only sanctioned way for admin pages, Server Actions, and Route
 * Handlers to learn who the caller is. Middleware performs a cheap cookie check
 * for routing only; every privileged read or mutation must call one of these
 * helpers so authorization is always enforced on the server.
 *
 * The role is re-read from the database rather than taken from the session
 * payload. That keeps a single authoritative source and means a role change or
 * account deletion takes effect on the next request instead of waiting for a
 * session to expire.
 */

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
};

/**
 * Returns the authenticated administrator, or `null` when there is no valid
 * session or the user row no longer exists.
 */
export async function getCurrentUser(): Promise<AdminUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true },
  });

  return user ?? null;
}

/**
 * Returns the authenticated administrator or redirects to the login page.
 *
 * `nextPath` is passed through so the login page can return the user to the
 * page they originally requested.
 */
export async function requireUser(nextPath?: string): Promise<AdminUser> {
  const user = await getCurrentUser();

  if (!user) {
    redirect(buildLoginRedirect(nextPath));
  }

  return user;
}

/**
 * Returns the authenticated administrator when they hold at least `minimum`,
 * otherwise fails safely: unauthenticated callers are sent to the login page
 * and authenticated-but-unauthorized callers get a 403 through `notFound`-free
 * explicit denial.
 */
export async function requireRole(
  minimum: AdminRole,
  nextPath?: string,
): Promise<AdminUser> {
  const user = await requireUser(nextPath);

  if (!roleAtLeast(user.role, minimum)) {
    throw new AuthorizationError(
      `Requires role ${minimum} or higher to access this resource.`,
    );
  }

  return user;
}

/** Requires general administrative access (`ADMIN` or `SUPER_ADMIN`). */
export function requireAdmin(nextPath?: string): Promise<AdminUser> {
  return requireRole(AdminRole.ADMIN, nextPath);
}

/** Requires the highest administrative access. */
export function requireSuperAdmin(nextPath?: string): Promise<AdminUser> {
  return requireRole(AdminRole.SUPER_ADMIN, nextPath);
}

/**
 * Thrown when an authenticated user lacks the required role. Kept distinct from
 * "not signed in" so callers never respond to an authorization failure by
 * prompting for credentials again.
 */
export class AuthorizationError extends Error {
  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "AuthorizationError";
  }
}
