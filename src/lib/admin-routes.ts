/**
 * Admin route constants and pure route logic.
 *
 * Deliberately free of server-only and Next.js imports so middleware, Server
 * Components, the login Client Component, and unit tests can all share one
 * definition of these paths and of what counts as a safe redirect target.
 */
export const ADMIN_ROOT_PATH = "/admin";
export const ADMIN_LOGIN_PATH = "/admin/login";
export const ADMIN_MEDIA_PATH = "/admin/media";
export const AUTH_API_BASE_PATH = "/api/auth";

/**
 * Accepts only same-origin absolute paths inside the admin area.
 *
 * The post-login destination arrives in a `next` query parameter, which is
 * attacker-controllable. Restricting it to admin paths blocks open-redirect
 * attempts such as `//evil.example`, `https://evil.example`, or
 * `javascript:` targets.
 */
export function isSafeInternalPath(value: string | null | undefined): boolean {
  if (!value || value.startsWith("//")) {
    return false;
  }

  return (
    value === ADMIN_ROOT_PATH || value.startsWith(`${ADMIN_ROOT_PATH}/`)
  );
}

/** Builds the login URL, preserving a safe in-app return path. */
export function buildLoginRedirect(nextPath?: string | null): string {
  if (!isSafeInternalPath(nextPath) || nextPath === ADMIN_LOGIN_PATH) {
    return ADMIN_LOGIN_PATH;
  }

  return `${ADMIN_LOGIN_PATH}?next=${encodeURIComponent(nextPath as string)}`;
}
