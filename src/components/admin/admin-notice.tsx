"use client";

import { useEffect, useRef } from "react";

/**
 * The page-level notice an admin action leaves after redirecting back.
 *
 * The redirect adds `?saved=` or `?error=`, and the App Router treats a page
 * with different search params as a new page: it is mounted afresh, so the
 * button that was used no longer exists and focus would fall back to the
 * document. The notice therefore takes focus when it appears (it is not an
 * extra Tab stop), which puts the reader at the outcome and the next Tab into
 * the page's content.
 *
 * `alert` (the default) is for a refusal the administrator has to act on, such
 * as why a change could not be saved: assertive, with the accent border.
 * `status` is for an ordinary outcome such as "Customer updated": polite, so
 * it does not interrupt, with a neutral border. The text is always the fixed,
 * server-chosen message.
 */
export function Notice({ message, tone = "alert" }: { message?: string; tone?: "alert" | "status" }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);

  return message ? (
    <p
      aria-live={tone === "status" ? "polite" : undefined}
      className={`mb-5 border ${tone === "status" ? "border-border" : "border-accent"} p-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
      ref={ref}
      role={tone}
      tabIndex={-1}
    >
      {message}
    </p>
  ) : null;
}
