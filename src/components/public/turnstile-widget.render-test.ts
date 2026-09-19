import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TurnstileWidget } from "@/components/public/turnstile-widget";
import { TURNSTILE_RESPONSE_FIELD } from "@/lib/security/turnstile-widget";

/**
 * Regression coverage for the Phase 10A live defect.
 *
 * Cloudflare's implicit mode fills any server-rendered `.cf-turnstile`
 * container the instant `api.js` executes. React then hydrates that container
 * from markup that had no children and deletes the provider's nodes — no
 * console error, no visible widget, and no response field in the submission.
 *
 * The invariant that prevents it is entirely observable in the server markup:
 * nothing about the widget may exist before hydration except an empty
 * container. This pass runs without the `react-server` export condition,
 * because `react-dom/server` refuses to load under it.
 */

// `tsconfig.json` sets `"jsx": "preserve"`, because Next.js owns the JSX
// transform. Outside Next.js, tsx/esbuild falls back to the classic runtime and
// emits bare `React.createElement` calls, so the component file's own JSX needs
// `React` as a global. Next.js itself never uses this path.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const markup = () =>
  renderToStaticMarkup(React.createElement(TurnstileWidget, { siteKey: "1x00000000000000000000AA" }));

describe("Turnstile widget server markup", () => {
  it("never server-renders an implicit auto-render container", () => {
    const html = markup();
    assert.ok(!/class="[^"]*cf-turnstile/.test(html), "an implicit `.cf-turnstile` container re-introduces the hydration race");
    assert.ok(!html.includes("data-sitekey"), "implicit mode is driven by data attributes and must not appear");
  });

  it("never server-renders the provider script, so it cannot execute before hydration", () => {
    const html = markup();
    assert.ok(!html.includes("<script"), "the script is appended in an effect, after this subtree has hydrated");
    assert.ok(!html.includes("challenges.cloudflare.com"), "no provider URL is emitted during server rendering");
  });

  it("hands React an empty container to hydrate", () => {
    const html = markup();
    const container = /<div data-turnstile-container="">([\s\S]*?)<\/div>/.exec(html);
    assert.ok(container, "the explicit render target is present");
    assert.equal(container[1], "", "the container must hydrate empty so React deletes nothing the provider injected");
  });

  it("submits exactly one React-owned response field, empty until a challenge is solved", () => {
    const html = markup();
    const fields = html.match(new RegExp(`name="${TURNSTILE_RESPONSE_FIELD}"`, "g")) ?? [];
    assert.equal(fields.length, 1, "a provider-injected duplicate would make the submitted value ambiguous");
    assert.match(html, new RegExp(`<input[^>]*name="${TURNSTILE_RESPONSE_FIELD}"[^>]*value=""`), "the field is submitted empty until a challenge is solved");
  });

  it("announces verification state accessibly", () => {
    const html = markup();
    assert.match(html, /aria-live="polite"/);
  });
});
