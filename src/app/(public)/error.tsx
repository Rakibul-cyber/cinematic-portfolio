"use client";

import { useEffect } from "react";

import { Container } from "@/components/ui/container";

/**
 * Public error boundary.
 *
 * Shows a calm, branded message and a retry. The error itself is logged to the
 * server console only — a visitor never sees a stack trace, a query, or any
 * other internal detail.
 */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[public] Rendering failed:", error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main-content">
      <Container>
        <div className="flex min-h-[60svh] flex-col justify-center py-24">
          <h1 className="editorial-balance max-w-3xl font-display text-[clamp(2.5rem,6vw,6rem)] leading-[0.9] font-medium tracking-[-0.04em]">
            Something went wrong.
          </h1>
          <p className="mt-8 max-w-md text-sm leading-7 text-muted-foreground">
            The page could not be loaded. Please try again in a moment.
          </p>
          <button
            className="mt-10 inline-flex min-h-12 w-fit items-center justify-center border border-border px-5 text-xs font-semibold tracking-[0.12em] uppercase transition-colors duration-300 hover:border-foreground hover:bg-foreground hover:text-background"
            onClick={reset}
            type="button"
          >
            Try again
          </button>
        </div>
      </Container>
    </main>
  );
}
