import Link from "next/link";

/**
 * Query string for `page` of a filtered admin list.
 *
 * Carries the list's active filters (search, status) so moving between pages
 * keeps the same result set. Empty filters and page 1 are left out, matching
 * the plain list address.
 */
export function pageHref(filters: Record<string, string | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "?";
}

const linkClass = "inline-flex min-h-11 items-center border border-border px-4 text-sm hover:border-foreground";

/** Previous / next links for a server-paginated admin list, with the current position. */
export function AdminPagination({ page, pageSize, total, filters }: { page: number; pageSize: number; total: number; filters: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Past the last page (an old link, or a filter that now matches fewer), still offer the way back.
  if (pages === 1 && page === 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-6 flex flex-wrap items-center gap-3">
      {page > 1 ? (
        <Link className={linkClass} href={pageHref(filters, Math.min(page - 1, pages))} rel="prev">
          Previous<span className="sr-only"> page</span>
        </Link>
      ) : null}
      <span className="text-sm text-muted-foreground">
        Page {Math.min(page, pages)} of {pages}
      </span>
      {page < pages ? (
        <Link className={linkClass} href={pageHref(filters, page + 1)} rel="next">
          Next<span className="sr-only"> page</span>
        </Link>
      ) : null}
    </nav>
  );
}
