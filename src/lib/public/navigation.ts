/**
 * True for the section's own page and anything nested under it, so
 * `/work/some-project` keeps Work current. The root is current only on the
 * homepage itself, never as the parent of every route. A trailing slash is
 * tolerated so `/work/` matches like `/work`.
 */
export function isCurrentSection(pathname: string, href: string): boolean {
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}
