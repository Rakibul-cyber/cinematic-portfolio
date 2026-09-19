/**
 * Browser-side Turnstile contract.
 *
 * Deliberately **explicit-render only**. Cloudflare's implicit mode scans the
 * document for `.cf-turnstile` elements as soon as `api.js` executes and
 * injects an iframe into whatever it finds. Inside a React application that
 * scan is a race against hydration: the container is server-rendered with no
 * children, so when React hydrates a container the provider has already filled,
 * React deletes the nodes it did not render. The widget is then gone, silently
 * and without a console error, and no response field is ever submitted.
 *
 * Explicit rendering removes the race entirely — nothing renders until this
 * module is asked to, which only happens in an effect, after hydration.
 *
 * This module is imported by both the client widget and the server action, so
 * it must stay free of DOM access at module scope and free of `server-only`
 * and `client-only` imports.
 */

/** The action name asserted server-side in `verifyTurnstile`. */
export const TURNSTILE_ACTION = "inquiry";

/** The form field the server action reads the response token from. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";

/**
 * `render=explicit` is load-bearing: without it `api.js` performs the implicit
 * DOM scan described above the moment it executes.
 */
export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export type TurnstileCallbacks = {
  onToken: (token: string) => void;
  onExpired: () => void;
  onError: () => void;
};

export type TurnstileRenderOptions = {
  sitekey: string;
  action: string;
  theme: "auto" | "light" | "dark";
  /**
   * False so Cloudflare never injects its own `cf-turnstile-response` input.
   * The token lives in React state and is submitted through a single
   * React-owned hidden input, so there is exactly one field with that name and
   * exactly one source of truth for its value.
   */
  "response-field": false;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "error-callback": () => void;
};

export type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
  ready(callback: () => void): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function turnstileRenderOptions(
  siteKey: string,
  callbacks: TurnstileCallbacks,
): TurnstileRenderOptions {
  return {
    sitekey: siteKey,
    action: TURNSTILE_ACTION,
    theme: "dark",
    "response-field": false,
    callback: callbacks.onToken,
    "expired-callback": callbacks.onExpired,
    "timeout-callback": callbacks.onExpired,
    "error-callback": callbacks.onError,
  };
}

export function getTurnstile(): TurnstileApi | null {
  return typeof window === "undefined" ? null : (window.turnstile ?? null);
}

/**
 * The one piece of module state: a single in-flight load promise, because the
 * provider script is a document-wide singleton and must never be appended
 * twice. It is write-once per successful load and cleared on failure so a
 * later mount can retry.
 */
let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  const ready = getTurnstile();
  if (ready) return Promise.resolve(ready);
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Turnstile requires a browser document"));
  }

  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener(
      "load",
      () => {
        const api = getTurnstile();
        if (api) api.ready(() => resolve(api));
        else {
          loading = null;
          reject(new Error("Turnstile loaded without exposing its API"));
        }
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        loading = null;
        script.remove();
        reject(new Error("Turnstile script failed to load"));
      },
      { once: true },
    );
    document.head.append(script);
  });

  return loading;
}
