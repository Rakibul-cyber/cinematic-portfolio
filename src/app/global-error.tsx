"use client";

import { useEffect } from "react";

import { SITE_THEME_COLOR } from "@/lib/constants";
import { reportBoundaryError } from "@/lib/monitoring/report";

/**
 * Last-resort error boundary.
 *
 * This replaces the root layout, so it renders its own `<html>` and `<body>`
 * and cannot rely on the application stylesheet having loaded — which is
 * exactly the situation it exists for. The few inline styles below are
 * deliberate rather than a shortcut.
 *
 * A visitor sees a calm message and a retry. The digest and the stack stay
 * server-side and, when monitoring is configured, go to the error tracker.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportBoundaryError(error, "global");
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          alignItems: "center",
          background: SITE_THEME_COLOR,
          color: "#f4f1ea",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          margin: 0,
          minHeight: "100svh",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 500, margin: 0 }}>
            Something went wrong.
          </h1>
          <p style={{ lineHeight: 1.75, marginTop: "1.5rem", opacity: 0.7 }}>
            The page could not be loaded. Please try again in a moment.
          </p>
          <button
            onClick={reset}
            style={{
              background: "transparent",
              border: "1px solid rgba(244, 241, 234, 0.3)",
              color: "inherit",
              cursor: "pointer",
              fontSize: "0.75rem",
              letterSpacing: "0.12em",
              marginTop: "2rem",
              minHeight: "3rem",
              padding: "0 1.25rem",
              textTransform: "uppercase",
            }}
            type="button"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
