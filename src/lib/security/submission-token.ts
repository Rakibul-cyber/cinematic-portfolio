"use client";

import { useEffect, useState } from "react";

/**
 * The idempotency token for one logical inquiry submission.
 *
 * It must be generated **in the browser, after hydration**, and never during
 * rendering. `/contact` is a statically prerendered ISR route, so a token
 * produced while rendering is baked into cached HTML: every visitor served
 * that cache entry would carry the same token for up to an hour, and the
 * second submission would be answered from the replay branch as a success
 * that was never recorded. Generating during render is also a hydration
 * mismatch, because the server and the client produce different values for
 * the same attribute.
 *
 * The field name is exported so the form and the server action cannot drift.
 */
export const SUBMISSION_TOKEN_FIELD = "submissionToken";

/**
 * The state updater used on mount, extracted so its two guarantees are
 * directly testable without a DOM:
 *
 *   * an already-issued token is returned unchanged, so the token is stable
 *     across re-renders, across React 19 StrictMode's double-invoked effects,
 *     and across a rejected submission that the visitor retries — which is
 *     what keeps the retry the *same* logical submission;
 *   * an empty token is replaced with a fresh one.
 */
export function nextSubmissionToken(current: string): string {
  return current === "" ? crypto.randomUUID() : current;
}

/**
 * Returns `""` on the server and through hydration, then the issued token.
 *
 * Callers must treat `""` as "not ready to submit". The server stays
 * authoritative regardless: `inquirySchema` requires a UUID, so an empty
 * token is rejected there whatever the browser does.
 */
export function useSubmissionToken(): string {
  const [token, setToken] = useState("");

  useEffect(() => {
    setToken(nextSubmissionToken);
  }, []);

  return token;
}
