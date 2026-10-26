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

const ADMIN_REDIRECT_BASE = "https://admin.invalid";
const MAX_ENCODING_LAYERS = 4;

function hasDotSegment(pathname: string): boolean {
  return pathname.split("/").some((segment) => segment === "." || segment === "..");
}

/**
 * Accepts only same-origin absolute paths inside the admin area.
 *
 * The post-login destination arrives in a `next` query parameter, which is
 * attacker-controllable. Restricting it to admin paths blocks open-redirect
 * attempts such as `//evil.example`, `https://evil.example`, or
 * `javascript:` targets.
 */
export function isSafeInternalPath(value: string | null | undefined): boolean {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("#") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }

  const queryIndex = value.indexOf("?");
  let decodedPath = queryIndex === -1 ? value : value.slice(0, queryIndex);

  try {
    // Validate the complete value too, so malformed encodings in the query do
    // not create a browser-dependent redirect target.
    decodeURIComponent(value);

    for (let layer = 0; layer < MAX_ENCODING_LAYERS; layer += 1) {
      if (hasDotSegment(decodedPath)) {
        return false;
      }

      const nextPath = decodeURIComponent(decodedPath);
      if (nextPath === decodedPath) {
        break;
      }

      // Encoded separators or delimiters make URL interpretation ambiguous.
      if (
        nextPath.includes("\\") ||
        nextPath.includes("?") ||
        nextPath.includes("#") ||
        nextPath.split("/").length !== decodedPath.split("/").length
      ) {
        return false;
      }

      decodedPath = nextPath;

      if (layer === MAX_ENCODING_LAYERS - 1) {
        return false;
      }
    }
  } catch {
    return false;
  }

  if (hasDotSegment(decodedPath)) {
    return false;
  }

  try {
    const normalized = new URL(value, ADMIN_REDIRECT_BASE);
    return (
      normalized.origin === ADMIN_REDIRECT_BASE &&
      (normalized.pathname === ADMIN_ROOT_PATH ||
        normalized.pathname.startsWith(`${ADMIN_ROOT_PATH}/`))
    );
  } catch {
    return false;
  }
}

/** Returns the validated post-login destination or the safe admin landing page. */
export function getAdminRedirectTarget(value?: string | null): string {
  return isSafeInternalPath(value) ? (value as string) : ADMIN_ROOT_PATH;
}

/** Builds the login URL, preserving a safe in-app return path. */
export function buildLoginRedirect(nextPath?: string | null): string {
  if (!isSafeInternalPath(nextPath) || nextPath === ADMIN_LOGIN_PATH) {
    return ADMIN_LOGIN_PATH;
  }

  return `${ADMIN_LOGIN_PATH}?next=${encodeURIComponent(nextPath as string)}`;
}
