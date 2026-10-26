"use client";

import { useEffect, useRef } from "react";

/**
 * The page-level notice an admin action leaves after redirecting back, such
 * as "Customer updated" or why a category could not be deleted.
 *
 * The redirect replaces the page, so focus would otherwise fall back to the
 * document and the notice would be easy to miss. It takes focus when it
 * appears (it is not an extra Tab stop) and stays an alert for screen readers
 * that announce on insertion. The text is the fixed, server-chosen message.
 */
export function Notice({ message }: { message?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message) ref.current?.focus();
  }, [message]);

  return message ? (
    <p className="mb-5 border border-accent p-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" ref={ref} role="alert" tabIndex={-1}>
      {message}
    </p>
  ) : null;
}
