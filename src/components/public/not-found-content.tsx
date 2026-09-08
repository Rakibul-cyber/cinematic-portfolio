import Link from "next/link";

import { Container } from "@/components/ui/container";

/**
 * Public 404 body.
 *
 * Shown for unknown URLs and for project slugs that are not published. The
 * wording is identical in both cases on purpose: an unpublished project must
 * be indistinguishable from one that never existed.
 */
export function NotFoundContent() {
  return (
    <main id="main-content">
      <Container>
        <div className="flex min-h-[60svh] flex-col justify-center py-24">
          <p className="text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
            404
          </p>
          <h1 className="editorial-balance mt-5 max-w-3xl font-display text-[clamp(2.75rem,7vw,7rem)] leading-[0.88] font-medium tracking-[-0.04em]">
            This page is not here.
          </h1>
          <p className="mt-8 max-w-md text-sm leading-7 text-muted-foreground">
            The address may be out of date, or the page may have moved.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              className="inline-flex min-h-12 items-center justify-center border border-border px-5 text-xs font-semibold tracking-[0.12em] uppercase transition-colors duration-300 hover:border-foreground hover:bg-foreground hover:text-background"
              href="/"
            >
              Home
            </Link>
            <Link
              className="inline-flex min-h-12 items-center justify-center border border-border px-5 text-xs font-semibold tracking-[0.12em] uppercase transition-colors duration-300 hover:border-foreground hover:bg-foreground hover:text-background"
              href="/work"
            >
              View the work
            </Link>
          </div>
        </div>
      </Container>
    </main>
  );
}
