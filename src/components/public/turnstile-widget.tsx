"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  TURNSTILE_RESPONSE_FIELD,
  getTurnstile,
  loadTurnstile,
  turnstileRenderOptions,
} from "@/lib/security/turnstile-widget";

type Status = "loading" | "ready" | "solved" | "error";

const MESSAGES: Record<Status, string> = {
  loading: "Loading verification…",
  ready: "Please complete the verification before sending.",
  solved: "Verification complete.",
  error: "Verification could not be loaded. Please reload the page and try again.",
};

/**
 * Cloudflare Turnstile, rendered explicitly after hydration.
 *
 * The container is server-rendered **empty** and stays empty through
 * hydration, so React never reconciles away provider-injected nodes. The
 * script is appended in an effect, which by definition runs after this
 * subtree has hydrated, so the widget cannot appear before React is finished
 * with the DOM.
 *
 * The token is React state and is never persisted or logged; it exists only
 * long enough to travel with the form submission, and the server remains the
 * sole authority on whether it is valid.
 */
export function TurnstileWidget({
  siteKey,
  resetSignal = 0,
}: {
  siteKey: string;
  resetSignal?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>("loading");

  const onToken = useCallback((value: string) => {
    setToken(value);
    setStatus("solved");
  }, []);
  const onExpired = useCallback(() => {
    setToken("");
    setStatus("ready");
  }, []);
  const onError = useCallback(() => {
    setToken("");
    setStatus("error");
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        // A second render for the same mount would produce two widgets and two
        // tokens, so the widget id is the guard as well as the handle.
        if (cancelled || widgetIdRef.current !== null) return;
        widgetIdRef.current =
          turnstile.render(container, turnstileRenderOptions(siteKey, { onToken, onExpired, onError })) ?? null;
        setStatus((current) => (current === "loading" ? "ready" : current));
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      widgetIdRef.current = null;
      if (widgetId !== null) getTurnstile()?.remove(widgetId);
    };
  }, [siteKey, onToken, onExpired, onError]);

  // A Turnstile response is single-use, so a rejected submission must be
  // followed by a fresh challenge rather than a resubmission of a spent token.
  useEffect(() => {
    if (resetSignal === 0) return;
    const widgetId = widgetIdRef.current;
    if (widgetId === null) return;
    setToken("");
    setStatus("ready");
    getTurnstile()?.reset(widgetId);
  }, [resetSignal]);

  return (
    <div className="grid gap-2">
      <div data-turnstile-container="" ref={containerRef} />
      <input name={TURNSTILE_RESPONSE_FIELD} type="hidden" value={token} />
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {MESSAGES[status]}
      </p>
    </div>
  );
}
